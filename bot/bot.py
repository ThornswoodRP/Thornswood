"""
The Thornswood bot. This one stays running, unlike Build-Discord.py which sets
the server up once and exits.

What it does:

  Joins    draws a card and puts it in #welcome
  Tickets  a panel in #tickets-and-applications, one private thread per
           ticket, and a copy pushed to the site so the inbox has it whether
           or not anybody was looking at Discord. #tickets is the staff only
           channel closed tickets are written down in, and where a ticket
           goes when its thread will not open
  Services posts in the staff channel what the VPS watchdog says has died
           and when it is back, from its outbox, once each (issue #447)
  Reports  says each thing sent in on the site's public report page in the
           staff channel, the day it arrives
  Holds    a panel in #choose-your-hold where a Member picks their hold
           and which announcements ping them
  Testing  #known-issues is a forum with one post per open GitHub issue
           labelled Dev Findings or Main Findings; the post goes when the
           issue is closed, which is when its fix is on main. #test-tasks is a
           forum of test tasks: one for each issue closed as fixed (its "Test
           task:" comment), always tagged Main, because main is where testers
           test, plus any posted by hand tagged Main (/test-task,
           python bot.py --post-task). #dev-test-tasks, a staff only forum
           in Staff, holds the test tasks whose comment says "Server: Dev":
           a measurement someone on dev has to take, open issue or closed,
           and any posted by hand tagged Dev. The same read writes the
           site's Known Issues page (the #known-issues list) and its
           roadmap (the "roadmap:" labels) for the site to show (#3140).
           The channels get there once, by hand, with
           python bot.py --setup-channels [--apply] (the testing channels
           section below)
  Heartbeat writes heartbeat.json beside this file every minute, so the
           watchdog can tell a bot that is running from one that is on
           Discord (issue #449)
  Uptime   pings an outside monitor every minute while it is on Discord, so
           a bot or a VPS that stops is noticed from outside the box (#449)

Everything it needs is in env:

  DISCORD_TOKEN    the bot token
  THORNSWOOD_SITE  https://thornswood.net
  THORNSWOOD_KEY   shared secret the site checks on /api/ticket
  JOIN_CHANNEL     name of the channel join cards go in, default general
  TICKET_CHANNEL   public channel the panel lives in, comma separated, first wins
  TICKET_LOG       staff only channel closed tickets are recorded in, and where
                   a ticket goes when its thread will not open. Checked by its
                   permissions, never trusted by its name
  STAFF_ROLES      comma separated role IDs (preferred) or names, who gets
                   pulled into every ticket thread
  CREATOR_ROLES    comma separated role IDs or names, added to Apply:
                   Content Creator only
  UPPER_STAFF_ROLES comma separated role IDs only, who is pinged and added
                   to Faction Leader tickets. Must include the Owner role
                   ID and each department Lead ID (today Lead Gamemaster).
                   Names are ignored and logged. Empty or unset means a
                   Faction Leader ticket is refused: nobody else is added,
                   and the applicant is told to try again later.
  TICKET_COOLDOWN  seconds between one person's tickets, default 300
  WATCH_CHANNEL_ID id of the staff channel the watchdog's messages go in,
                   default whatever staff-channel.txt beside this file
                   holds, #staff-updates. Leave it unset
  WATCH_DIR        the watchdog's folder, default the one Watch-Services.ps1
                   makes on the VPS
  WATCH_READ_EVERY seconds between reads of its outbox, default 60
  HOLD_CHANNEL     channel the hold panel lives in, default choose-your-hold
  MEMBER_ROLE      role ID (preferred) or name that may pick a hold, default Member
  TEST_TASK_ROLES  comma separated role IDs (preferred) or names, who may
                   post a test task, default Owner,Dev,Lead Gamemaster,Lead GM
  TEST_TASKS_CHANNEL, TEST_FINDINGS_CHANNEL, KNOWN_ISSUES_CHANNEL
                   default test-tasks, test-findings, known-issues
  DEV_TASKS_CHANNEL   the staff forum of dev test tasks, default dev-test-tasks
  DEV_TASKS_CATEGORY  id of the category it is made in, default the Staff
                      category, 1549254990110134374
  GITHUB_TOKEN_FILE  where the box admin service writes the bot's GitHub
                   token, issues write on KNOWN_ISSUES_REPO, made by its App
                   every half hour (#5184), default
                   C:\Thornswood-Admin\for-bot\github-token.json. Read at
                   each call; while it holds a token that has not ended, that
                   is the token
  GITHUB_TOKEN     the token used when that file has none: for the
                   repository's issues, read and write: the rule comments and
                   Report a problem (#3155) write. A secret, set only in
                   bot.env.json. With neither, no #known-issues posts and no
                   problems filed
  PROBLEM_LABELS   labels a filed problem gets, default Tester report,area: triage
  PROBLEM_CHANNEL  channel the Report a problem panel lives in, default
                   TEST_FINDINGS_CHANNEL
  TESTER_ROLES     comma separated role IDs (preferred) or names that may use
                   that panel besides staff, default Playtester
  KNOWN_ISSUES_REPO   default ThornswoodRP/Thornswood
  KNOWN_ISSUES_LABELS default Dev Findings,Main Findings
  KNOWN_ISSUES_EVERY  seconds between GitHub reads, default 300, never under 60
  PUBLIC_LISTS_FILE   where the site's known issues and roadmap are written,
                      default the site's data/from-bot/lists.json on the VPS
  HEARTBEAT_FILE   where the heartbeat goes, default heartbeat.json beside this
                   file, which is where the watchdog reads it
  HEARTBEAT_EVERY  seconds between heartbeats, default 60
  PING_URL         the outside monitor's ping address. A secret, set only by
                   Install-Bot.ps1 -SetPing and never written to the log. Not
                   set means no ping
  PING_EVERY       seconds between pings, default 60
  PING_TIMEOUT     seconds one ping may take, default 10

It is written to keep going when a piece of it fails. A card that will not
draw still gets a greeting, a site that is down still gets a thread, and a
thread that cannot be made still gets an answer to the person who asked.
"""
# First, before anything else: Python 3.11 or newer, or a plain message
# saying so (#2276). Shared with every bot test.
import _pyguard  # noqa: F401
import asyncio
import datetime
import json
import os
import re
import time
import traceback
import sys
import typing
import urllib.error
import urllib.parse
import urllib.request

# The bot's own records, joins.json, open-tickets.json, heartbeat.json
# and commands-synced.json, go in a folder of their own, data beside bot.py, and
# so does bot.log, which the service writes (issue #1104). The service's
# account may write there and nowhere else in the bot's folder: the code is
# read only to it, so nothing that gets into the bot can rewrite bot.py or put
# a module beside it for the next start to import. The service names the
# folder in THORNSWOOD_BOT_DATA (BotService.cs). With no data folder yet, a
# box whose full install has not run since, the records stay beside bot.py
# where they were, so a code only deploy never starts the join numbers again;
# the full install moves them across while the bot is stopped (Bot-Service.ps1).
HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get('THORNSWOOD_BOT_DATA') or (
    os.path.join(HERE, 'data') if os.path.isdir(os.path.join(HERE, 'data')) else HERE)

# The roots the bot trusts are its own file, roots.pem in its data folder: the
# roots in certifi's bundle (requirements.txt, by hash) less those trust.py
# leaves out, eMudhra's (#3111). It is written again at every start, before
# discord.py or urllib makes a single connection.
#
# Not the box's certificate store. Its automatic root update is off by
# policy, so it lacks what discord.com chains to and the handshake died with
# "unable to get local issuer certificate" (#2736); and it holds emSign Root
# CA - G1 in LocalMachine\Root (read on the box 21 Oct). Python's default
# SSL context on Windows loads that store as well as SSL_CERT_FILE, so
# pointing SSL_CERT_FILE at the file is not enough on its own. Every
# connection the bot makes goes through CONTEXT instead, made from the file
# alone: urllib through the opener installed here, discord.py's HTTP and
# gateway through the connector TrustedClient gives it at login.
# SSL_CERT_FILE names the same file for anything else in the process.
#
# Always this file, whatever the environment named before. Install-Bot used to
# set SSL_CERT_FILE to certifi's bundle as the box's own Python found it, with
# none of py-libs on its path, so it named the certifi that Python had
# installed for itself, if any, and not the one requirements.txt pins.
# certifi is in requirements.txt beside discord.py, so a bot without it is
# missing its libraries and stops here, saying so, rather than connecting
# without its roots (#2736).
import trust
ROOTS = os.path.join(DATA_DIR, 'roots.pem')
_trusted, _left_out = trust.write_bundle(ROOTS)
os.environ['SSL_CERT_FILE'] = ROOTS
os.environ['REQUESTS_CA_BUNDLE'] = ROOTS
CONTEXT = trust.context(ROOTS)
urllib.request.install_opener(
    urllib.request.build_opener(urllib.request.HTTPSHandler(context=CONTEXT)))

import discord

import card


# A discord.Client whose every request and gateway connection verifies
# against CONTEXT (#3111). trust.py makes the class, the one every script in
# bot/ that logs in to Discord makes its client from (#3604).
TrustedClient = trust.client_class(CONTEXT)


def _load_env_file(argv):
    """
    --env-file PATH: read bot.env.json into the environment before anything
    below reads it, so the one-time setup and --post-task can be run by hand
    on the VPS with the service's settings. The service never passes it.
    """
    if '--env-file' not in argv:
        return
    at = argv.index('--env-file')
    with open(argv[at + 1], encoding='utf-8-sig') as f:
        for k, v in json.load(f).items():
            os.environ[str(k)] = str(v)


if __name__ == '__main__':
    _load_env_file(sys.argv)

TOKEN = os.environ.get('DISCORD_TOKEN', '').strip()
SITE = os.environ.get('THORNSWOOD_SITE', 'https://thornswood.net').rstrip('/')
KEY = os.environ.get('THORNSWOOD_KEY', '').strip()
# Joins go where people actually are, not into the read-only welcome page.
# Change JOIN_CHANNEL in bot.env.json on the VPS to move it.
WELCOME = os.environ.get('JOIN_CHANNEL',
          os.environ.get('WELCOME_CHANNEL', 'general')).strip().lower()
# Names the ticket panel will answer to, in order, first one that exists wins.
#
# This was a single name, and the single name was 'tickets'. The channel was
# then renamed to #tickets-and-applications, which moved nothing and broke
# everything: the panel message stayed where it was and still worked, so the
# server looked fine, while the bot could no longer find the channel. Every
# ticket after the rename had nowhere to open a thread and nowhere to fall back
# to. A list costs nothing and a rename stops mattering.
TICKETS = [n.strip().lower() for n in
           os.environ.get('TICKET_CHANNEL',
                          'tickets-and-applications,applications').split(',')
           if n.strip()]
TICKETS_SAID = ' or #'.join(TICKETS)

# THE TICKET DESKS (#3317, Patrick's page card q-3317-ticket-split, A): one
# channel a kind of ticket, each with a panel offering only its kinds, and the
# private threads open off it. A Tickets category holds help and reports, an
# Applications category the three kinds of application; Build-Discord.py makes
# them by these names. TICKETS above is the one channel of before the split,
# #tickets-and-applications. It is used only on a server that has none of
# these, so a server not yet built again keeps working, and where it is still
# there beside them its panel says where the tickets went.
TICKET_DESKS = [
    ('get-help',          ('help',)),
    ('report-someone',    ('report',)),
    ('apply-to-playtest', ('playtest',)),
    ('apply-for-a-seat',  ('jarl', 'faction')),
    ('apply-for-staff',   ('gamemaster', 'loremaster', 'moderator', 'dev', 'creator')),
]
# Every channel a ticket thread can be off.
TICKET_NAMES = [d for d, _k in TICKET_DESKS] + [n for n in TICKETS
                                                  if n not in dict(TICKET_DESKS)]


def desk_of(kind):
    """The desk channel a kind of ticket opens in, by name."""
    for desk, kinds in TICKET_DESKS:
        if kind in kinds:
            return desk
    return None


def ticket_channel(guild, kind):
    """The channel this kind of ticket opens its thread off: its desk, or on a
       server not yet split, the one channel of before."""
    desk = desk_of(kind)
    ch = by_name(guild, [desk]) if desk else None
    if ch is not None:
        return ch
    if any(by_name(guild, [d]) is not None for d, _k in TICKET_DESKS):
        return None
    return by_name(guild, TICKETS)

# Where a closed ticket is written down, and it is NOT the channel above.
# Everybody who can apply can read that one, so a closed application posted
# there is somebody else's answers sitting in front of the next person
# queueing up, and it buries the panel besides. Staff only, and made if it is
# not there. A ticket whose private thread will not open goes here too, so a
# report about somebody is never posted where that somebody can read it.
# log_channel checks that by the channel's permissions, not by these names.
# #ticket-log first since #3317, which moved the staff only #tickets out of the
# public Applications category into Staff under that name; #tickets is still
# answered to, so a server not yet built again keeps working.
TICKET_LOG = [n.strip().lower() for n in
              os.environ.get('TICKET_LOG', 'ticket-log,tickets').split(',')
              if n.strip()]
# Who gets pulled into every ticket thread.
# Tokens may be Discord role snowflake IDs (digits) or names. IDs survive a
# rename; names are kept so an unmigrated bot.env.json still works.
# The council (Owner, Co-Owner and every lead, #3317) reads every ticket, so
# it is in the default; a bot.env.json that lists ids needs their ids added.
_STAFF_RAW = [r.strip() for r in
              os.environ.get('STAFF_ROLES',
                             'Owner,Co-Owner,Lead Dev,Lead Gamemaster,Lead Loremaster,'
                             'Lead Moderator,Lead Content Creator,Lead Support,'
                             'Gamemaster,Dev,Loremaster,Moderator').split(',')
              if r.strip()]

# Roles that see one kind of ticket and not the rest.
#
# Content Creator is not general staff: that role is for social media, and it
# has no reason to be reading somebody's playtest application or a report about
# another person. It does have every reason to read applications to join it,
# so it is added to those threads and no others.
_CREATOR_RAW = [r.strip() for r in
                os.environ.get('CREATOR_ROLES', 'Content Creator').split(',')
                if r.strip()]

def _role_tokens(raw):
    ids, names = set(), set()
    for t in raw:
        t = (t or '').strip()
        if not t:
            continue
        if t.isdigit():
            ids.add(int(t))
        else:
            names.add(t.lower())
    return ids, names

def _role_hit(role, ids, names):
    return getattr(role, 'id', None) in ids or role.name.lower() in names

def _who_hits(who, ids, names):
    for r in getattr(who, 'roles', None) or []:
        if _role_hit(r, ids, names):
            return True
    return False

def _guild_roles(guild, ids, names):
    return [r for r in guild.roles if _role_hit(r, ids, names)]

STAFF_IDS, STAFF_NAMES = _role_tokens(_STAFF_RAW)
CREATOR_IDS, CREATOR_NAMES = _role_tokens(_CREATOR_RAW)
# Name-only views kept for refusal text and older harnesses that read STAFF.
STAFF = sorted(STAFF_NAMES) if STAFF_NAMES else [t.lower() for t in _STAFF_RAW if not t.isdigit()]
CREATOR = sorted(CREATOR_NAMES) if CREATOR_NAMES else [t.lower() for t in _CREATOR_RAW if not t.isdigit()]
EXTRA_STAFF = {'creator': CREATOR}
EXTRA_STAFF_IDS = {'creator': (CREATOR_IDS, CREATOR_NAMES)}

# Faction Leader tickets go only to the role IDs in UPPER_STAFF_ROLES.
# IDs only: a name, including Owner, is ignored so a renamed or invented
# role cannot read these. Owner's ID has to be in the list; it is not
# added by name. Empty or unset means the ticket is refused, never opened
# to general staff. A future Lead role is added here by its ID.
_UPPER_RAW = [r.strip() for r in
              os.environ.get('UPPER_STAFF_ROLES', '').split(',')
              if r.strip()]


def upper_staff_ids(raw):
    """Snowflake IDs from UPPER_STAFF_ROLES. Names are ignored, not matched."""
    ids, ignored = set(), []
    for t in raw:
        t = (t or '').strip()
        if not t:
            continue
        if t.isdigit():
            ids.add(int(t))
        else:
            ignored.append(t)
    return ids, ignored


UPPER_STAFF_IDS, UPPER_STAFF_IGNORED = upper_staff_ids(_UPPER_RAW)


def ticket_pull_tokens(kind):
    """The role ids and names pinged and added for a ticket of this kind."""
    if kind == 'faction':
        return set(UPPER_STAFF_IDS), set()
    ids, names = set(STAFF_IDS), set(STAFF_NAMES)
    extra = EXTRA_STAFF_IDS.get(kind)
    if extra:
        ids |= extra[0]
        names |= extra[1]
    return ids, names


def ticket_pull_roles(kind, guild):
    ids, names = ticket_pull_tokens(kind)
    if kind == 'faction':
        return [r for r in getattr(guild, 'roles', None) or []
                if getattr(r, 'id', None) in ids]
    return [r for r in getattr(guild, 'roles', None) or [] if _role_hit(r, ids, names)]


def warn_upper_staff_config(guilds=None):
    """
    Log when Faction Leader routing cannot work. Log only: never a
    channel, a DM or a ping. Empty is said at process start. IDs that
    match no role are said once the guilds are known.
    """
    if not UPPER_STAFF_IDS:
        log('UPPER_STAFF_ROLES is empty, so Faction Leader tickets will '
            'be refused. Set it to the Owner role ID and the Lead '
            'Gamemaster role ID.')
        return
    for g in guilds or ():
        have = set(getattr(r, 'id', None)
                   for r in getattr(g, 'roles', None) or [])
        if not (UPPER_STAFF_IDS & have):
            log('UPPER_STAFF_ROLES ids %s match no role in "%s", so '
                'Faction Leader tickets will be refused.'
                % (sorted(UPPER_STAFF_IDS), getattr(g, 'name', '?')))


FACTION_REFUSED = ('This application cannot be opened right now. '
                   'Try again later.')
FACTION_THREAD_FAILED = ('This application could not be opened. '
                         'Try again later.')


# The staff channel, #staff-updates, where staff hear what needs fixing: the
# watchdog's messages (a service down or back, the disk, the disk forecast,
# what the outside watcher on One sees) and the sessions that went wrong.
# Staff, not public: an outage is something to fix, not an announcement.
# Patrick, 11 Oct: staff status updates go in #staff-updates, 1549254991082946570.
#
# BY ID AND NOT BY NAME, and the reason is the whole point. This server has two
# channels called news, the public one releases are announced in and a staff
# one, and by_name hands back whichever the server lists first, so a watcher
# matching on a name would eventually tell everybody the site was down.
#
# staff-channel.txt holds that id, sits beside this file and is tracked in git,
# unlike the webhook files next to it, so the id is not a secret. Install-Bot
# sends it with the code.
#
# NOT dev-channel.txt. That one is the dev updates channel, where dev releases
# are announced, and only Set-DevNews.ps1 reads it, to check the dev release
# webhook. The watchdog read it until 12 Oct (#2501), from a comment here that
# called that channel "the staff channel", so every outage and the disk
# forecast's test went in among the dev release posts.
def _staff_channel_id():
    """#staff-updates' id, from staff-channel.txt beside this file. 0 without."""
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        with open(os.path.join(here, 'staff-channel.txt')) as f:
            return int(f.read().strip())
    except Exception:
        return 0


def _int_env(name, fallback):
    """A number from env, and the default when it is missing or nonsense."""
    try:
        n = int(os.environ.get(name, '') or fallback)
        return n if n > 0 else fallback
    except ValueError:
        return fallback


# WATCH_CHANNEL_ID in bot.env.json on the VPS overrides it. Nothing in the
# repository sets it, and it should stay unset: one id, in one tracked file.
WATCH_ID = _int_env('WATCH_CHANNEL_ID', _staff_channel_id())


# The channel that hears about a session that went wrong: the same one.
#
# It once read `_staff_channel_id() or _dev_channel_id()`, so with no
# staff-channel.txt it took the dev updates channel's id and never reached the
# name lookup in _trouble_channel. The first deploy on 22 September logged
# "speaking in #news": right kind of place, wrong place, and it would have put
# every crash report in with the release announcements.
#
# 0 when there is no file, and then _trouble_channel says so in the bot log
# and nothing is said in Discord. It used to look staff-general up by name
# instead (#2940). TROUBLE_CHANNEL_ID in bot.env.json overrides it.
TROUBLE_ID = _int_env('TROUBLE_CHANNEL_ID', _staff_channel_id())

# Where the site writes the sessions that went wrong. The bot and the site run
# on the same box, so this is a file rather than a request: no ticket, no port
# and nothing to keep in step. In for-bot, a folder of the site's data that
# holds only what the site writes for the bot, so the bot's account is granted
# read on that and never on the site's own records, sessions.json among them
# (issue #1102).
TROUBLE_FILE = os.environ.get(
    'TROUBLE_FILE', r'C:\Thornswood-Docs\data\for-bot\trouble.json')
TROUBLE_EVERY = _int_env('TROUBLE_EVERY', 120)

# Which message in Discord says which session went wrong, so the post goes
# when its row leaves trouble.json (#3942). The bot's own, beside joins.json.
TROUBLE_POSTS = os.path.join(DATA_DIR, 'trouble-posts.json')

# Where the site writes what people send in on its public report page, read
# the same way as trouble.json and said in the same staff channel.
REPORTS_FILE = os.environ.get(
    'REPORTS_FILE', r'C:\Thornswood-Docs\data\for-bot\inbox.json')
REPORTS_EVERY = _int_env('REPORTS_EVERY', 120)
# More than this many in one look is a script, not five people, because the
# site takes five an hour from any one place. Then one line says how many.
REPORTS_AT_ONCE = 5


# The folder the watchdog Watch-Services.ps1 puts on the VPS. The bot runs on
# the same box, as its own service account, which Install-Bot.ps1 grants read
# on this folder and write on alerts-sent-bot.txt (Bot-Service.ps1).
WATCH_DIR = os.environ.get('WATCH_DIR', r'C:\Thornswood-Watch')
# Once a minute. The watchdog itself runs every five and gives this two and a
# half minutes to post a message before it posts it through its webhook.
WATCH_READ_EVERY = _int_env('WATCH_READ_EVERY', 60)

if not TOKEN:
    raise SystemExit('No DISCORD_TOKEN. Install-Bot.ps1 sets it.')

intents = discord.Intents(guilds=True, members=True)


class Thornswood(TrustedClient):
    async def setup_hook(self):
        """
        Everything that has to happen once per process, and not once per
        reconnect.

        discord.py runs this inside login(), before the gateway is connected
        and before any event is dispatched. on_ready is the other thing, and
        it is not the same thing: it fires again every time the connection
        drops and comes back, which on a bad evening is repeatedly.

        A persistent view is registered against its custom_id so a button on
        a message from last week still works after a restart. Registering it
        a second time is not free and is not meaningful, and the two lines
        were sitting in on_ready where every reconnect did it again.
        """
        # First, so a site that is slow to answer below cannot delay it.
        asyncio.create_task(heartbeat())      # for the watchdog, #449
        asyncio.create_task(uptime_ping())    # for the outside monitor, #449
        # The one switch (#428), before the panel is built from KINDS.
        set_open(await asyncio.get_running_loop().run_in_executor(None, site_open))
        log('the world is %s' % ('open to everybody' if OPEN else 'in alpha, open by application'))
        if UPPER_STAFF_IGNORED:
            log('UPPER_STAFF_ROLES is IDs only, ignored names: %s'
                % ', '.join(UPPER_STAFF_IGNORED))
        warn_upper_staff_config()
        self.add_view(TicketPanel())          # so it keeps working after a restart
        for desk, _kinds in TICKET_DESKS:     # and every desk's (#3317)
            if desk_kinds(desk):
                self.add_view(TicketPanel(desk))
        self.add_view(TicketTools())          # and so does Close on every old ticket
        self.add_view(HoldPanel())            # and the hold and ping buttons
        self.add_view(OfficePanel())          # and a Jarl's office buttons (#2551)
        self.add_view(FactionPanel())         # and a faction Leader's member buttons (#3317)
        self.add_view(ProblemPanel())         # and Report a problem in #test-findings (#3155)


client = Thornswood(intents=intents)
tree = discord.app_commands.CommandTree(client)


def log(*a):
    print('[thornswood-bot]', *a, flush=True)


def as_typed(v, n=1000):
    """
    Words somebody else typed, as Discord will show them and no more.

    Everything a stranger writes goes through this before it is posted: an
    @everyone in it is text rather than a ping, a role id is text, and
    markdown in it is shown as it was typed instead of being read as
    formatting. It trims the ends and cuts at n characters first, so one long
    answer cannot take a post over Discord's limit on its own.

    The send that carries the text still switches mentions off (see the ticket
    thread and report_say). This is the first of the two, not the only one: a
    mention Discord learns to write differently tomorrow would get past the
    escaping and still not ping anybody.
    """
    v = str(v or '').strip()[:n]
    return discord.utils.escape_mentions(discord.utils.escape_markdown(v))


# ------------------------------------------------------------------ site --
def push(kind, title, detail, by, discord_id, rules=None):
    """Send a ticket to the site. Runs off the event loop, and a failure here
       is never allowed to lose the ticket: the thread in Discord is the
       record, this is the convenience.

       rules is the application's answer to the rules question, as
       {'said': their words, 'yes': whether it read as a yes}, or None on a
       ticket that does not ask it. The site keeps the latest one against the
       Discord id (#428), because the inbox is trimmed and the record of who
       accepted the rules should not be."""
    if not KEY:
        # Silent for as long as this has existed, which means a bot with no key
        # set looked exactly like a working one: the thread appeared, the site
        # inbox stayed empty, and nothing anywhere said why.
        log('THORNSWOOD_KEY is not set, so this ticket did NOT reach the site '
            'inbox. The thread in Discord is the only copy. Install-Bot.ps1 '
            'sets the key in bot.env.json on the VPS.')
        return
    sent = {
        'key': KEY, 'kind': kind, 'title': title,
        'detail': detail, 'by': by, 'discordId': str(discord_id)
    }
    if rules is not None:
        sent['rules'] = rules
    body = json.dumps(sent).encode()
    req = urllib.request.Request(
        SITE + '/api/ticket', data=body,
        headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            r.read()
    except Exception as e:
        log('site push failed:', e)


async def push_async(*a):
    try:
        await asyncio.get_running_loop().run_in_executor(None, push, *a)
    except Exception as e:
        log('site push failed:', e)


# Site copies still on their way. The event loop holds a task only weakly, so a
# task nothing else refers to can be collected before it has finished. This
# set holds each one until it is done, and each one takes itself out.
_pushes = set()


def by_name(guild, names, kind='text'):
    """
    Find a channel by name.

    guild.channels holds categories and voice rooms as well as text channels.
    A server with a category called General sitting above a text channel called
    general hands back the category, which has no send method, and the only
    sign of it is a traceback in this log and nothing at all in Discord. So
    only ever look in the list that can actually be posted in.
    """
    pool = guild.voice_channels if kind == 'voice' else guild.text_channels
    # In the order given, not the order the server happens to list its
    # channels in. With a public #tickets-and-applications and a staff only
    # #tickets both in the server, taking whichever came first down the
    # sidebar would have put the application panel in the staff channel.
    for want in names:
        for ch in pool:
            if ch.name.lower() == want:
                return ch
    return None


def private_channel_ok(guild, ch):
    """
    True when nobody outside staff can read this channel, by its permissions
    and not by its name.

    @everyone must be denied it, and so must every role that is not staff.
    Content Creator counts as outside, for the reason log_channel gives. Two
    kinds of role are skipped because no channel could ever keep them out: a
    role with Administrator reads every channel whatever its overwrites say,
    and a bot's own role is software somebody added to the server, this bot
    included. Counting either would make no channel private at all.

    A person given the channel by name, in a member overwrite, counts too,
    unless they hold a staff role or are a bot.

    Anything it cannot read is a no. The cost of a wrong no is a ticket that
    reaches the site inbox and not Discord; the cost of a wrong yes is a report
    about somebody in front of the person it is about.
    """
    try:
        if ch.permissions_for(guild.default_role).view_channel:
            return False
        roles = list(guild.roles)
        for r in roles:
            if r == guild.default_role or _role_hit(r, STAFF_IDS, STAFF_NAMES):
                continue
            if getattr(r.permissions, 'administrator', False):
                continue
            if getattr(r, 'is_bot_managed', lambda: False)():
                continue
            if ch.permissions_for(r).view_channel:
                return False
        for who, ow in (getattr(ch, 'overwrites', None) or {}).items():
            if who in roles or getattr(who, 'bot', False):
                continue
            if ow.view_channel and not _who_hits(who, STAFF_IDS, STAFF_NAMES):
                return False
        return True
    except Exception:
        log('could not read the permissions on #%s, so it is treated as '
            'public:\n' % getattr(ch, 'name', '?') + traceback.format_exc())
        return False


async def log_channel(guild, make=True):
    """
    The staff only channel closed tickets are recorded in, and where a ticket
    goes when its private thread will not open.

    Made rather than asked for, because the alternative is a feature that
    silently does nothing until somebody thinks to read a log. Deny first:
    @everyone cannot see it and only the staff roles are added back. Content
    Creator is left out on purpose, the same reason it is left out of every
    ticket that is not an application to join it.

    CHECKED, NOT TRUSTED BY NAME. TICKET_LOG's first name is tickets. Until
    24 September Build-Discord.py's PLAN made a #tickets in Help with
    mode='open', which everybody in the server could read. The PLAN now makes
    #tickets staff only, in Applications beside the panel, and that is the
    channel this is meant to find. But the PLAN's modes only apply to a
    channel it makes, never to one already there, so a #tickets left over
    from the old PLAN, or made by hand, keeps whatever permissions it had.
    This used to take the first channel with a TICKET_LOG name, so a public
    one would have become the log, and every closed application and every
    report that missed its thread would have gone into it. Now a channel with
    the right name and the wrong permissions is passed over and said so, and
    the next free name is made instead.
    """
    taken = set()
    for want in TICKET_LOG:
        for ch in guild.text_channels:
            if ch.name.lower() != want:
                continue
            taken.add(want)
            if private_channel_ok(guild, ch):
                return ch
            log('#%s is named in TICKET_LOG, but people outside staff can read '
                'it, so nothing from a ticket goes there.' % ch.name)
    if not make:
        return None

    free = [n for n in TICKET_LOG if n not in taken]
    if not free:
        log('every TICKET_LOG name (#%s) is a channel people outside staff can '
            'read, so there is nowhere private in Discord to put a ticket. '
            'Make one of them staff only, or add another name to TICKET_LOG '
            'in bot.env.json on the VPS.' % ', #'.join(TICKET_LOG))
        return None

    if not guild.me.guild_permissions.manage_channels:
        log('there is no #%s to record closed tickets in, and the bot cannot '
            'make one because it does not have Manage Channels. Either give '
            'it that, or make the channel by hand with staff the only ones '
            'who can see it.' % free[0])
        return None

    try:
        over = {
            guild.default_role: discord.PermissionOverwrite(view_channel=False),
            guild.me: discord.PermissionOverwrite(view_channel=True,
                                                  send_messages=True),
        }
        for r in guild.roles:
            if _role_hit(r, STAFF_IDS, STAFF_NAMES):
                over[r] = discord.PermissionOverwrite(view_channel=True,
                                                      send_messages=True)
        # In Staff, where Build-Discord.py has #ticket-log (#3317).
        where = discord.utils.get(getattr(guild, 'categories', None) or [], name='Staff')
        ch = await guild.create_text_channel(
            free[0],
            overwrites=over,
            category=where,
            topic='Every ticket that gets closed, with a link back to it, and '
                  'any ticket whose private thread would not open. Staff only.')
        log('made #%s for closed tickets, staff only' % ch.name)
        return ch
    except Exception:
        log('could not make #%s:\n' % free[0] + traceback.format_exc())
        return None


def thread_block(guild, ch):
    """
    Why a private thread cannot be opened in this channel, in words, or None.

    Discord answers every one of these with the same 50013 Forbidden, and the
    only place it lands is a traceback in a log on the VPS. Sending a message
    and opening a thread are separate permissions, so a bot that posted the
    panel perfectly well can still be unable to open a single ticket, and the
    symptom is an apology to the person applying and nothing anywhere else.
    Naming it here is the difference between a five minute fix and an evening.
    """
    try:
        p = ch.permissions_for(guild.me)
    except Exception:
        return None
    missing = [n for n, ok in (
        ('View Channel',             getattr(p, 'view_channel', True)),
        ('Send Messages',            getattr(p, 'send_messages', True)),
        ('Create Private Threads',   getattr(p, 'create_private_threads', True)),
        ('Send Messages in Threads', getattr(p, 'send_messages_in_threads', True)),
    ) if not ok]
    if not missing:
        return None
    return ('the bot does not have ' + ', '.join(missing) + ' in #' + ch.name)


# ----------------------------------------------------------------- joins --
# Which arrival each person was, on disk beside the code.
#
# Patrick, 24 September, with a screenshot of #welcome-travelers: "#28 twice".
# Daggerio came up the road at 19:41 and VENUS at 22:45, and both cards said
# "The 28th to walk in". The number was guild.member_count, the server's size
# at that moment, and the size falls whenever anybody leaves or is removed, so
# one departure between two joins handed the second arrival the first one's
# number, and it could go on doing that for ever.
#
# So the numbers are written down: the last one given out on each server, and
# the one each person got. A new arrival gets the next one, and somebody who
# leaves and comes back keeps theirs. It never goes below member_count, since
# anybody who joined while the bot was down was never counted here. And it
# never goes below JOIN_FLOOR, the highest number known to be on a card
# already: 28, off that screenshot, which is the one number the first join
# after this goes up has to get past, with no record yet and a member count
# that may by then be under it. Set JOIN_NUMBER_FLOOR in bot.env.json on the
# VPS if a later card went higher before this was installed.
#
# Install-Bot.ps1 sends a fixed list of files and deletes nothing in this
# folder, so neither the full run nor -CodeOnly can overwrite or remove it,
# and .gitignore keeps it out of the repo, like open-tickets.json.
JOINS = os.path.join(DATA_DIR, 'joins.json')
JOIN_FLOOR = _int_env('JOIN_NUMBER_FLOOR', 28)

# HOW LONG A NUMBER IS KEPT (#2353). It was kept for ever, after its person
# left too, and the privacy page did not name it. Decided by Patrick on 12
# October: a keeping time for each store, enforced in code. A number is kept
# while its person is in the Discord, and for JOIN_KEEP_DAYS after they leave,
# so coming back within a year still keeps it; then it goes. 'left' in each
# server's part of the record says when each numbered person was first seen
# gone, in milliseconds. 'last' is never aged: it is a count, not a person,
# and it is what stops a number being handed out twice.
JOIN_KEEP_DAYS = 365
JOIN_KEEP_EVERY = 60 * 60


def _joins_read():
    """
    The record, or {} when there is none yet. Raises when there is one and it
    cannot be read, so a file that is there and unreadable is never taken for
    an empty one and written over, which would start the numbers again.
    """
    if not os.path.exists(JOINS):
        return {}
    with open(JOINS, encoding='utf-8') as f:
        d = json.load(f)
    if not isinstance(d, dict):
        raise ValueError(JOINS + ' is not a JSON object')
    return d


def _joins_write(d):
    """Written to a file beside it and swapped in, so a write that fails half
       way leaves the old record whole rather than half of a new one."""
    tmp = JOINS + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(d, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, JOINS)


def _joins_of(rec, guild):
    """This server's part of the record, and the numbers in it by member id,
       each made empty when it is missing or not the shape it should be."""
    g = rec.get(str(guild.id))
    if not isinstance(g, dict):
        g = {}
    ids = g.get('members')
    if not isinstance(ids, dict):
        ids = {}
    return g, ids


def _joins_number(ids, member_id):
    """The number the record holds for this member, or None."""
    had = ids.get(str(member_id))
    return had if type(had) is int and had > 0 else None


def joins_age(rec, now_ms, here):
    """
    Ages the record in place and returns (marked, dropped).

    here is {server id as text: set of member ids as text} for each server
    whose member list is whole. Somebody numbered there and not in it is
    marked left at now_ms, unless already marked; somebody marked and in it
    again is unmarked. Then, on every server, a number whose person left more
    than JOIN_KEEP_DAYS ago goes with its mark. A mark that is not a time is
    a corrupt one and is left as it is, with its number, rather than guessed
    at. A server not in here (its list not whole, or the bot not in it) is
    never marked, only aged.
    """
    cut = now_ms - JOIN_KEEP_DAYS * 86400000
    marked = dropped = 0
    for gid, g in rec.items():
        if not isinstance(g, dict):
            continue
        ids = g.get('members')
        if not isinstance(ids, dict):
            continue
        left = g.get('left')
        if not isinstance(left, dict):
            left = {}
        if gid in here:
            for k in ids:
                if k not in here[gid] and k not in left:
                    left[k] = now_ms
                    marked += 1
            for k in [k for k in left if k in here[gid]]:
                del left[k]
                marked += 1
        for k in [k for k, t in left.items()
                  if type(t) in (int, float) and t < cut]:
            del left[k]
            ids.pop(k, None)
            dropped += 1
        if left:
            g['left'] = left
        else:
            g.pop('left', None)
    return marked, dropped



# A restore (scripts/vps/vps-restore-services.ps1) moves the joins.json it
# replaces to joins.json-before-restore-<stamp> beside it in the data folder,
# <stamp> the box's local yyyyMMdd-HHmmss, with -2, -3 for a second restore in
# the same second, and nothing deleted it (#3620). Decided by Patrick on 26 Oct
# (B): a set-aside copy is kept 30 days, so a restore can be undone, then
# deleted. By the time in its name, never the file's own times, which a move
# keeps from the original. Delete-Person.ps1 takes a deleted person out of one
# while it is here.
RESTORE_ASIDE_DAYS = 30
RESTORE_ASIDE = re.compile(r'^joins\.json-before-restore-(\d{8})-(\d{6})(?:-\d+)?$')


def age_restore_copies(folder, now):
    """
    Deletes the set-aside joins.json copies in folder older than
    RESTORE_ASIDE_DAYS by the stamp in their names, now a POSIX time in
    seconds. A link, or anything that is not a plain file, is left as it is.
    Returns (deleted names, [(name, reason)] it could not delete).
    """
    cut = now - RESTORE_ASIDE_DAYS * 86400
    deleted, failed = [], []
    try:
        names = sorted(os.listdir(folder))
    except OSError as e:
        return deleted, [(folder, str(e))]
    for n in names:
        m = RESTORE_ASIDE.match(n)
        if not m:
            continue
        try:
            at = datetime.datetime.strptime(m.group(1) + m.group(2), '%Y%m%d%H%M%S').timestamp()
        except ValueError:
            continue
        if at >= cut:
            continue
        p = os.path.join(folder, n)
        if os.path.islink(p) or not os.path.isfile(p):
            continue
        try:
            os.remove(p)
            deleted.append(n)
        except OSError as e:
            failed.append((n, str(e)))
    return deleted, failed

async def watch_join_numbers():
    """
    Marks who has left and drops the numbers past JOIN_KEEP_DAYS, as the bot
    comes up and every JOIN_KEEP_EVERY seconds. On the event loop and not in
    an executor, like arrival_number, so a join cannot write the record
    between this reading and writing it. A record that cannot be read or
    written is said in bot.log and left as it is; the next pass tries again.
    Nothing in here may end the loop.
    """
    await client.wait_until_ready()
    partial = set()
    while not client.is_closed():
        try:
            here = {}
            for gd in client.guilds:
                if gd.chunked:
                    here[str(gd.id)] = set(str(m.id) for m in gd.members)
                    partial.discard(gd.id)
                elif gd.id not in partial:
                    partial.add(gd.id)
                    log('join numbers: the member list of "%s" is not whole yet, '
                        'so nobody there is marked as gone until it is' % gd.name)
            rec = _joins_read()
            marked, dropped = joins_age(rec, int(time.time() * 1000), here)
            if marked or dropped:
                _joins_write(rec)
            if dropped:
                log('join numbers: %d dropped, their people gone more than %d days'
                    % (dropped, JOIN_KEEP_DAYS))
        except Exception:
            log('join numbers: could not age %s, so it is as it was until the '
                'next pass:\n%s' % (JOINS, traceback.format_exc()))
        try:
            gone, stuck = age_restore_copies(DATA_DIR, time.time())
            for n in gone:
                log('join numbers: deleted %s, set aside by a restore more than %d days ago'
                    % (n, RESTORE_ASIDE_DAYS))
            for n, why in stuck:
                log('join numbers: COULD NOT DELETE %s (%s); it is tried again in an hour' % (n, why))
        except Exception:
            log('join numbers: could not age the copies a restore set aside:\n%s'
                % traceback.format_exc())
        await asyncio.sleep(JOIN_KEEP_EVERY)


def joins_given(guild):
    """
    {member id: number} for everybody the record has numbered on this server,
    read and never written.

    backfill.py and redraw.py read the record through this and the two above,
    so a card they draw carries the number on_member_join gave, by the same
    reading of the file. Until 24 September they numbered by join order among
    the members still here and never opened it, so redraw.py --all would have
    put numbers on old cards that disagree with the record. Raises, like
    _joins_read, when the record is there and cannot be read.
    """
    g, ids = _joins_of(_joins_read(), guild)
    out = {}
    for k in ids:
        n = _joins_number(ids, k)
        if n is not None and str(k).isdigit():
            out[int(k)] = n
    return out


def arrival_number(guild, member):
    """
    Which arrival this member is on this server: the number they were given
    before, or the next one. When the record cannot be read or written this
    says so in the log and answers member_count, which is what every card
    said before, because a greeting never waits on a file.

    Called on the event loop and not in an executor, so two joins a moment
    apart cannot both read the same last number.
    """
    count = guild.member_count
    try:
        rec = _joins_read()
        g, ids = _joins_of(rec, guild)
        had = _joins_number(ids, member.id)
        if had is not None:
            n, said = had, 'came back and keeps number %d' % had
            left = g.get('left')
            if isinstance(left, dict) and str(member.id) in left:
                del left[str(member.id)]
                rec[str(guild.id)] = g
                _joins_write(rec)
        else:
            last = g.get('last')
            if type(last) is not int:
                last = 0
            n = max(last + 1, JOIN_FLOOR + 1, count or 0)
            ids[str(member.id)] = n
            g['members'] = ids
            g['last'] = n
            rec[str(guild.id)] = g
            _joins_write(rec)
            said = 'is number %d, with %s members' % (n, count)
    except Exception:
        log('join numbers: could not read or write %s, so this card says the '
            'member count, %s, which can repeat a number:\n%s'
            % (JOINS, count, traceback.format_exc()))
        return count
    log('join: %s %s' % (member, said))
    return n


@client.event
async def on_member_join(member):
    # First line in, before anything can go wrong, so the log can tell a join
    # that never reached the bot apart from one that reached it and failed.
    log('join: %s arrived in "%s"' % (member, member.guild.name))

    ch = by_name(member.guild, [WELCOME])
    if ch is None:
        log('no text channel called #%s to greet in' % WELCOME)
        return

    number = arrival_number(member.guild, member)
    name = member.display_name or member.name

    png = None
    try:
        avatar = member.display_avatar.replace(size=256, format='png')
        data = await avatar.read()
        png = await asyncio.get_running_loop().run_in_executor(
            None, card.render, name, data, number, None, member.name)
    except Exception:
        log('card failed:\n' + traceback.format_exc())

    line = '%s came up the road.' % member.mention
    try:
        if png is not None:
            await ch.send(line, file=discord.File(png, 'welcome.png'))
        else:
            await ch.send(line)
    except Exception:
        log('greeting failed:\n' + traceback.format_exc())


# --------------------------------------------------------------- tickets --
# 'Apply to play' is not here on purpose. Patrick, 28 Sep: "we are in alpha so
# the world is open by application". Anyone can download it, and the one way
# into the world is this application, which gives the Playtester role when it
# is accepted. A second 'Apply to play' asked people to guess which one they
# wanted and half of them guessed wrong. The key stays 'playtest' because the
# site inbox and ROLE_FOR file it under that name.
KINDS = [
    ('playtest',    'Apply to be an alpha playtester',
                    'How you get into the world. Anyone can apply. Break it and write down how.'),
    ('jarl',        'Apply: Jarl',          'A seat in a hold. In character, and the first ones come out of these.'),
    ('faction',     'Apply: Faction Leader', 'A seat at the head of a faction. In character, and the first ones come out of these.'),
    ('gamemaster',  'Apply: Gamemaster',    'Run events, settle disputes, hold the line in character.'),
    ('loremaster',  'Apply: Loremaster',    'Keep the history straight and write the rest of it.'),
    ('moderator',   'Apply: Moderator',     'The unglamorous one. Tickets, reports, difficult people.'),
    ('dev',         'Apply: Dev',           'Server, launcher, site, mods. Anything that compiles.'),
    ('creator',     'Apply: Content Creator', 'Video, streams, screenshots, writing about the place.'),
    ('report',      'Report somebody',      'Something happened and it should not have.'),
    ('help',        'I need help',          'It will not install, will not start, or will not connect.'),
]

# The role each application is asking for, so the thread and the site inbox say
# what it is without anybody reading three answers first. None of these grant
# anything: giving out the role is still a person deciding.
ROLE_FOR = {
    'playtest':   'Playtester',
    'jarl':       'Jarl of the hold named below',
    'faction':    'Faction Lead of the faction named below',
    'gamemaster': 'Gamemaster',
    'loremaster': 'Loremaster',
    'moderator':  'Moderator',
    'dev':        'Dev',
    'creator':    'Content Creator',
}

# Every job asks the same three things, because the answers that matter are the
# same three every time: what you have done, how much time you really have, and
# whether you want the job or the title.
def _job(what, examples):
    return [
        ('What experience do you have?',
         examples, True),
        ('How much time can you give it?',
         'Hours a week, and which days. Honest beats keen.', True),
        ('Why this role?',
         'What draws you to ' + what + ' rather than the rest.', True),
    ]

# Asked first, on the two tickets that are a way IN. Everything else on the
# panel is for somebody already here, who answered this to get here.
#
# It is a typed answer rather than a box to tick because Discord modals have no
# box to tick. What it is worth is the record: their own words, against their
# Discord id, at a time, kept in the thread and in the site inbox.
AGE_Q = ('Are you 18 or over?', 'Thornswood is an adult server. Yes or no.', False)
AGE_KINDS = ('playtest',)

# #428: before this, nobody ever accepted the rules. Somebody could join for the
# invite, be let in, press Play and have agreed to nothing. Asked on the same
# tickets as the age question, for the same reason and in the same way: their
# own words against their Discord id, at a time, in the thread, the site inbox
# and the site's record of who accepted (push, then /api/ticket on the site).
# Anything that does not read as a yes goes at the top of the thread for staff,
# and nobody is given the role without somebody reading it.
RULES_Q = ('Do you accept the rules in #rules?',
           'Read #rules and thornswood.net/rules first. Yes or no.', False)
RULES_KINDS = AGE_KINDS

_ACCEPT = ('yes', 'yep', 'yeah', 'yup', 'y ', 'ye', 'i do', 'i accept', 'accept',
           'i agree', 'agree', 'i have', "i've", 'sure', 'of course', 'ok',
           'okay', 'absolutely', 'definitely', 'read and', 'correct', 'affirmative')


def accepted_rules(text):
    """
    Whether an answer to the rules question reads as a yes.

    Generous, like said_yes, and it never refuses anybody by itself: a no only
    puts a line at the top of the thread for a person to read. A no word
    anywhere at the start wins, so "no, not yet" is never taken for a yes.
    """
    t = (text or '').strip().lower()
    if not t:
        return False
    if t == 'n' or t.startswith(_NO) or t.startswith(("don't", 'dont', 'do not',
                                                     'i do not', "i don't", 'i dont',
                                                     'haven', 'have not', 'not yet')):
        return False
    return t == 'y' or t.startswith(_ACCEPT)

_NO  = ('no', 'nope', 'nah', 'not ', 'under', 'minor')
_YES = ('yes', 'yep', 'yeah', 'yup', 'y ', 'ye', 'i am', 'im ', "i'm ", 'sure',
        'correct', 'of course', 'affirmative', 'over', 'above')


def said_yes(text):
    """
    Whether an answer to the age question reads as a yes.

    Generous on purpose, and it never rejects anything by itself. Somebody
    typing "27" or "im 34" has answered the question; somebody typing "no", or
    nothing at all, is the case this exists to catch. A guess about how a
    stranger types is not a good enough reason to throw an application away,
    so the worst this does is put a line at the top of the thread and leave it
    to a person.
    """
    t = (text or '').strip().lower()
    if not t:
        return False

    # A NUMBER BEATS A WORD, and this order is the whole fix.
    #
    # It used to check the yes words first, and "I'm 16" starts with "i'm ",
    # which is in that list. So a sixteen year old answering in a sentence
    # read as a yes and the thread was never flagged, which is the one answer
    # this function exists to catch.
    #
    # An age is 1 to 120. Anything bigger is a year, a postcode or a number of
    # hours, and treating "born in 2009" as an age of 2009 would be a yes for
    # the same person. A text with no age-like number in it falls through to
    # the words below exactly as before.
    #
    # ANY NUMBER UNDER EIGHTEEN IS A NO, even beside a bigger one. "my brother
    # is 30, im 16" is not an answer anybody should be reading as a yes, and
    # this function never rejects anybody by itself: a no here puts a line at
    # the top of the thread for a person to read.
    #
    # It costs the occasional honest answer a flag: "34 and have been for 2
    # years" reads as a no because of the 2. That is deliberate and is the
    # cheap direction to be wrong in. A flag costs somebody five seconds of
    # reading; a miss lets a minor through with nothing saying so.
    ages = []
    for n in re.findall(r'\d+', t):
        try:
            v = int(n)
        except Exception:
            continue
        if 1 <= v <= 120:
            ages.append(v)
    if ages:
        if min(ages) < 18:
            return False
        return True

    if t == 'n' or t.startswith(_NO):
        return False
    if t.startswith(_YES):
        return True
    return False


QUESTIONS = {
    # The one application to be in the world. It asks about the character,
    # because that is what somebody is here for, and about testing, because
    # that is what being in it means today. It does not ask who they are
    # outside the game: that is answered by them being in the Discord.
    #
    # Discord takes five questions on a form and no more, so the rules
    # question (#428) took the place of "Have you roleplayed before", which
    # now rides along in the character question's hint.
    'playtest': [
        AGE_Q,
        RULES_Q,
        ('Who do you want to play?',
         'A sentence about the character, and where you have roleplayed before, if anywhere.', True),
        ('How much time can you give it?', 'Hours a week, and which days.', True),
        ('Describe a bug you have run into', 'What you did, what happened, what should have happened. Short.', True),
    ],
    # The only application here that is answered in character. The seats are
    # empty and the first people to hold them are picked out of these, so the
    # questions ask about the character rather than about the person, and the
    # last one asks the thing that actually decides it: whether they can lose
    # the seat and keep playing.
    # The hold itself is a Select of the open seats only, built in
    # TicketModal (#3317, Patrick, 22 Oct: "only include the open seats").
    'jarl': [
        ('Who is your character?',
         'Name, where they come from, what they have been doing until now. In character.', True),
        ('What is their claim to the seat?',
         'Blood, a war record, coin, or being the one who stayed. Something a hold would accept.', True),
        ('What would they change in the hold?',
         'What they actually do with it. Answer as them, not as you.', True),
        ('What happens if they lose the seat?',
         'A seat that cannot be lost is not a seat. Say how you play that.', True),
    ],
    # A faction lead seat. The same three questions the Trading Company form
    # used to ask, answered in character. The second question is reworded so
    # it fits any faction, not the company and hauling; that wording is a
    # proposal. Required and optional stay as they were: long means optional.
    # The faction pick itself is a Select, required, built in TicketModal,
    # because a form with no faction is useless. The Free Skyrim Trading
    # Company is one of the seats (bot/factions.json).
    'faction': [
        ('Who is your character?',
         'Name, where they come from, what they have been doing until now. In character.', True),
        ('What would they do with the faction?',
         'What they actually do with it. Answer as them, not as you.', True),
        ('How much time can you give it?', 'Hours a week, and which days.', True),
    ],
    'gamemaster': _job('running events',
        'Events you have run, groups you have led, tables you have DMed.'),
    'loremaster': _job('the lore',
        'Worldbuilding, wikis, writing, anything you have kept consistent over time.'),
    'moderator': _job('moderating',
        'Servers or forums you have moderated, and roughly how big.'),
    'dev': _job('the code',
        'Languages, projects, a repo link. Papyrus and C# are the useful ones here.'),
    'creator': _job('making things about Thornswood',
        'Channel, streams, a portfolio, anything you have put out.'),
    'report': [
        ('Who, and where?', 'Name and the channel or the place in the world.', False),
        ('What happened?', 'What they did, what you did, and roughly when.', True),
        ('Anything we can look at?', 'Screenshots, a clip, a time to check the log against.', True),
    ],
    'help': [
        ('What is going wrong?', 'One line.', False),
        ('What were you doing when it broke?', 'Installing, launching, connecting, playing.', True),
        ('What did it say, if anything?', 'Paste the error.', True),
    ],
}


# Named factions, names only, beside this file. Other is always added in
# code, last, and is never stored here. A name change is a pull request.
# A named faction is offered only while its "<faction> Leader" role has
# nobody in it (#3317); Other is always offered.
FACTIONS_FILE = os.path.join(HERE, 'factions.json')
FACTION_OTHER = 'Other'
FACTION_PICK_Q = 'Which faction?'
FACTION_OTHER_Q = 'If Other, which faction?'
FACTION_OTHER_HINT = 'Only if you picked Other. The name of the faction.'
HOLD_PICK_Q = 'Which hold?'
# THE SEAT RULE (#3317, Patrick, 22 Oct, 11:03 AM): "any Staff role can't
# also be a faction leader which includes Jarl's (Jarls are faction leaders
# but have a separate application on purpose ...)". He picked the bot
# refusing it (page card q-3317-seat-rule-check, A): staff cannot apply for
# a seat, and a seat holder cannot apply for staff. Every staff role counts,
# Trial Gamemaster, Content Creator and Support included, so the names are
# Build-Discord.py's STAFF, and test-3317-seats.py holds the two to the same
# list. STAFF_ROLES ids count too.
LEADERSHIP_KINDS = ('jarl', 'faction')
SEAT_RULE_STAFF = ('Owner', 'Co-Owner',
                   'Lead Dev', 'Dev',
                   'Lead Gamemaster', 'Gamemaster', 'Trial Gamemaster',
                   'Lead Loremaster', 'Loremaster',
                   'Lead Moderator', 'Moderator',
                   'Lead Content Creator', 'Content Creator',
                   'Lead Support', 'Support')
# The applications that make somebody staff. Apply: Lead and Apply: Support
# join this when they are on the panel.
STAFF_JOB_KINDS = ('gamemaster', 'loremaster', 'moderator', 'dev', 'creator')
# A faction's leader role uses its short name, as Build-Discord.py makes it.
FACTION_SHORT = {'Thalmor Remnant': 'Thalmor', 'The Companions': 'Companions'}
# Djinn, 12 Oct 2026. On the public panel, word for word.
STAFF_LEADERSHIP_RULE = 'No GM or staff member (Loremaster, Discord Moderator, or any other staff role) may hold an in-game RP role with faction leadership, such as a Jarl or a faction lead.'
SEAT_STAFF_REFUSED = ('You hold a staff role (%s). Nobody on staff may hold a '
                      'Jarl seat or lead a faction, so this application is '
                      'closed to you.')
SEAT_HELD_REFUSED = ('You hold %s. Nobody who holds a Jarl seat or leads a '
                     'faction may be on staff. To apply, give the seat up '
                     'first: say so in an "I need help" ticket.')
NO_OPEN_HOLD = ('Every Jarl seat is held right now, so there is nothing to '
                'apply for. When one opens it is listed here.')


def faction_leader_role(faction):
    """The leader role of a named faction: "Thalmor Leader"."""
    return FACTION_SHORT.get(faction, faction) + ' Leader'


def jarl_role(hold):
    return 'Jarl of ' + hold


def seat_roles():
    """Every seat of the world, as role names: each Jarl, then each faction leader."""
    return ([jarl_role(h) for h in OFFICE_TOWNS] +
            [faction_leader_role(f) for f in faction_names()])


def _role_named(guild, name):
    for r in getattr(guild, 'roles', None) or []:
        if getattr(r, 'name', None) == name:
            return r
    return None


def seat_is_open(guild, role_name):
    """
    Nobody holds this seat. A seat whose role is not on the server yet is
    open: nobody can hold a role that does not exist.
    """
    r = _role_named(guild, role_name)
    return r is None or not list(getattr(r, 'members', None) or [])


def open_holds(guild):
    """The holds whose Jarl seat is empty, in the order of OFFICE_TOWNS."""
    return [h for h in OFFICE_TOWNS if seat_is_open(guild, jarl_role(h))]


def open_factions(guild):
    """The named factions whose leader seat is empty, in factions.json order."""
    return [f for f in faction_names()
            if seat_is_open(guild, faction_leader_role(f))]


def seats_held(who):
    """The seat roles this person holds, by name."""
    seats = set(seat_roles())
    return [r.name for r in getattr(who, 'roles', None) or []
            if getattr(r, 'name', None) in seats]


def seat_refusal(kind, who, guild):
    """
    Why this person cannot open this application, in words, or None.

    Asked when they pick from the panel and again when the form comes back.
    Unlike ticket_refusal it holds for staff too, because the rule is about
    staff. Anything that goes wrong in here lets them through, for the reason
    ticket_refusal gives, and the council reading the ticket is the check.
    """
    try:
        if kind in LEADERSHIP_KINDS:
            held = leadership_staff_held(who)
            if held:
                return SEAT_STAFF_REFUSED % ', '.join(held)
            if kind == 'jarl' and not open_holds(guild):
                return NO_OPEN_HOLD
        if kind in STAFF_JOB_KINDS:
            held = seats_held(who)
            if held:
                return SEAT_HELD_REFUSED % ', '.join(held)
        return None
    except Exception:
        log('the seat rule could not be checked, so this one was let '
            'through:\n' + traceback.format_exc())
        return None


def faction_names():
    """The named factions, from factions.json beside this file. Other is not in it."""
    try:
        with open(FACTIONS_FILE, encoding='utf-8') as f:
            d = json.load(f)
        if isinstance(d, list):
            return [str(n).strip() for n in d if str(n).strip()]
    except Exception as e:
        log('could not read factions.json:', e)
    return []


def faction_pick_options(guild=None):
    """
    Select options for the form: every named faction whose leader seat is
    open, then Other last. With no guild to look in, every named faction.
    """
    names = faction_names() if guild is None else open_factions(guild)
    opts = [discord.SelectOption(label=n[:100], value=n[:100]) for n in names]
    opts.append(discord.SelectOption(label=FACTION_OTHER, value=FACTION_OTHER))
    return opts


def hold_pick_options(guild=None):
    """Select options for the Jarl form: every hold whose Jarl seat is open."""
    holds = list(OFFICE_TOWNS) if guild is None else open_holds(guild)
    return [discord.SelectOption(label=h, value=h) for h in holds]


def faction_pick_is_known(picked):
    """True for a named faction in factions.json, or for Other.

    Other is a normal option and is not flagged. A value that is not on
    the list (a tampered submit) is not known. Empty is not known.
    """
    name = (picked or '').strip()
    if not name:
        return False
    if name == FACTION_OTHER:
        return True
    return name in faction_names()


def field_said(item):
    """What a form field holds: a Select's first pick, or a TextInput's text."""
    vals = getattr(item, 'values', None)
    if isinstance(vals, (list, tuple)):
        return (str(vals[0]) if vals else '').strip()
    return (getattr(item, 'value', None) or '').strip()


def leadership_staff_held(who):
    """
    Names of the staff roles they hold, for the seat rule.

    Every staff role counts (SEAT_RULE_STAFF, and any STAFF_ROLES id), wider
    than is_staff, which decides /close and the ticket limits.
    """
    try:
        ids = set(STAFF_IDS)
        names = set(STAFF_NAMES) | set(n.lower() for n in SEAT_RULE_STAFF)
        found = []
        for r in getattr(who, 'roles', None) or []:
            if _role_hit(r, ids, names):
                found.append(r.name)
        return found
    except Exception:
        return []


class TicketModal(discord.ui.Modal):
    def __init__(self, kind, label, guild=None):
        super().__init__(title=label[:45])
        self.kind = kind
        self.label_text = label
        self.fields = []
        self.faction_select = None
        self.faction_other = None
        self.hold_select = None
        # Discord takes five items on a form. The faction kind uses all five:
        # a required Select of every open faction seat plus Other (discord.py
        # 2.6.0 put Select inside a modal; 2.7.1 is the pin), an optional
        # Other box, and the three copied questions. The Jarl kind is a
        # required Select of the open holds and its four questions. The
        # seats are read off the guild the form is opened in.
        if kind == 'jarl':
            sel = discord.ui.Select(
                placeholder='Pick a hold',
                options=hold_pick_options(guild),
                min_values=1,
                max_values=1,
                required=True)
            self.hold_select = sel
            self.add_item(discord.ui.Label(
                text=HOLD_PICK_Q[:45],
                component=sel))
        if kind == 'faction':
            sel = discord.ui.Select(
                placeholder='Pick a faction',
                options=faction_pick_options(guild),
                min_values=1,
                max_values=1,
                required=True)
            self.faction_select = sel
            self.add_item(discord.ui.Label(
                text=FACTION_PICK_Q[:45],
                component=sel))
            other = discord.ui.TextInput(
                label=FACTION_OTHER_Q[:45],
                placeholder=FACTION_OTHER_HINT[:100],
                style=discord.TextStyle.short,
                required=False,
                max_length=200)
            self.faction_other = other
            self.add_item(other)
        for q, ph, long in QUESTIONS[kind]:
            item = discord.ui.TextInput(
                label=q[:45],
                placeholder=ph[:100],
                style=discord.TextStyle.paragraph if long else discord.TextStyle.short,
                required=not long,
                max_length=1000 if long else 200)
            self.fields.append(item)
            self.add_item(item)

    async def on_submit(self, interaction):
        # Checked again here, and counted here rather than on the panel, so a
        # form opened by mistake and cancelled costs nobody five minutes. See
        # TICKET_COOLDOWN for why there is a limit at all.
        no = (ticket_refusal(interaction) or
              seat_refusal(self.kind, interaction.user, interaction.guild))
        if no:
            await interaction.response.send_message(no, ephemeral=True)
            return
        # Faction Leader tickets go only to the IDs in UPPER_STAFF_ROLES.
        # Empty, or IDs that match no role, means refuse: do not open a
        # thread only the applicant can see, and do not fall through to
        # general staff. Other kinds are unchanged.
        if self.kind == 'faction':
            if not UPPER_STAFF_IDS:
                log('UPPER_STAFF_ROLES is empty, so a Faction Leader ticket '
                    'was refused. Set it to the Owner role ID and the Lead '
                    'Gamemaster role ID.')
                await interaction.response.send_message(
                    FACTION_REFUSED, ephemeral=True)
                return
            if not ticket_pull_roles('faction', interaction.guild):
                log('UPPER_STAFF_ROLES ids %s matched no role on this '
                    'server, so a Faction Leader ticket was refused'
                    % sorted(UPPER_STAFF_IDS))
                await interaction.response.send_message(
                    FACTION_REFUSED, ephemeral=True)
                return
        # Before the first await, so two forms sent in the same moment cannot
        # both get past the check above.
        _last_ticket[_ticket_key(interaction.guild, interaction.user)] = _now()
        await interaction.response.defer(ephemeral=True, thinking=True)
        guild = interaction.guild
        who = interaction.user

        asking = ROLE_FOR.get(self.kind)

        def answered(want):
            """What they typed in the question that reads exactly like this."""
            for item, (q, _, _) in zip(self.fields, QUESTIONS[self.kind]):
                if q == want:
                    return field_said(item)
            return ''

        age_said = answered(AGE_Q[0]) if self.kind in AGE_KINDS else ''

        # The rules answer, kept for the site's record of who accepted them.
        rules = None
        rules_said = ''
        if self.kind in RULES_KINDS:
            rules_said = answered(RULES_Q[0])
            rules = {'said': rules_said[:200], 'yes': accepted_rules(rules_said)}

        # The faction pick is read again here. Other is a normal option and
        # is not flagged. A value that is not a named faction and not Other
        # (a tampered submit) is flagged. The pick and the Other box stay out of the opening line
        # and out of Asking for: they go only in the escaped answers below.
        picked = field_said(self.faction_select) if self.faction_select is not None else ''
        other_said = field_said(self.faction_other) if self.faction_other is not None else ''
        hold = field_said(self.hold_select) if self.hold_select is not None else ''

        def written(clean):
            lines = []
            if self.kind == 'jarl':
                lines.append('**%s**\n%s'
                             % (HOLD_PICK_Q, clean(hold) or 'nothing said'))
            if self.kind == 'faction':
                lines.append('**%s**\n%s'
                             % (FACTION_PICK_Q, clean(picked) or 'nothing said'))
                lines.append('**%s**\n%s'
                             % (FACTION_OTHER_Q, clean(other_said) or 'nothing said'))
            for item, (q, _, _) in zip(self.fields, QUESTIONS[self.kind]):
                lines.append('**%s**\n%s'
                             % (q, clean(field_said(item)) or 'nothing said'))
            out = '\n\n'.join(lines)
            if asking:
                out = '**Asking for:** ' + asking + '\n\n' + out
            # Anything that does not read as a yes says so at the top, in words,
            # on the line staff read first. It never stops the ticket: losing
            # somebody's application over how they phrased one answer would be
            # worse than a person spending two seconds reading it.
            if self.kind in AGE_KINDS and not said_yes(age_said):
                out = ('**CHECK THIS ONE.** Asked if they are 18 or over they '
                       'said "%s".\n\n' % (clean(age_said) or 'nothing')) + out
            if rules is not None and not rules['yes']:
                out = ('**CHECK THIS ONE.** Asked if they accept the rules they '
                       'said "%s".\n\n' % (clean(rules_said) or 'nothing')) + out
            # A seat can be filled between the form opening and coming back,
            # and two people can apply for the same open seat; the council
            # reads which. A pick that was never on the list is a tampered
            # submit.
            if self.kind == 'faction' and not faction_pick_is_known(picked):
                out = ('**CHECK THIS ONE.** The faction they picked is not on '
                       'the list.\n\n') + out
            elif (self.kind == 'faction' and picked != FACTION_OTHER
                  and not seat_is_open(guild, faction_leader_role(picked))):
                out = ('**CHECK THIS ONE.** The faction they picked has a '
                       'leader now.\n\n') + out
            if self.kind == 'jarl' and hold not in OFFICE_TOWNS:
                out = ('**CHECK THIS ONE.** The hold they picked is not on '
                       'the list.\n\n') + out
            elif self.kind == 'jarl' and not seat_is_open(guild, jarl_role(hold)):
                out = ('**CHECK THIS ONE.** The hold they picked has a Jarl '
                       'now.\n\n') + out
            return out

        # Two copies of the same ticket, because the two places that take it
        # protect themselves differently (#1354).
        #
        # detail is as they typed it, for the site, which escapes its own
        # output and whose inbox is the record of what they really wrote.
        #
        # shown is what goes into Discord, where their words would otherwise be
        # read as formatting and as mentions. Before this, an answer of
        # "@everyone" pinged the server from inside a staff thread, a role
        # mention pulled a role into it, and a few asterisks could hide the
        # rest of the application behind a heading. The questions and the
        # CHECK THIS ONE line are ours and stay bold; nothing of theirs does.
        detail = written(lambda v: v)
        shown = written(as_typed)

        title =('%s, %s' % (self.label_text, who.display_name))[:96]

        # Mentioning a role does not put anybody in a private thread. Only
        # people who have been added to one can see it, so a ticket opened
        # without this was visible to the applicant and to nobody else, and the
        # @mention went into a room staff were not in. They are added one at a
        # time, which is the only way Discord offers.
        # Faction Leader tickets go only to the IDs in UPPER_STAFF_ROLES.
        # Other kinds still use STAFF_ROLES (and Content Creator on creator
        # applications).
        staff_roles = ticket_pull_roles(self.kind, guild)
        if not staff_roles:
            ids, names = ticket_pull_tokens(self.kind)
            log('no role matched ids %r or names %r, so nobody will be pulled '
                'into this ticket. Set STAFF_ROLES in bot.env.json to the role '
                'ids or names this server actually uses.'
                % (sorted(ids), sorted(names)))
        head = '%s opened this. %s' % (who.mention,
                                       ' '.join(r.mention for r in staff_roles))

        ch = ticket_channel(guild, self.kind)
        why = None
        opened = None
        posted = False

        if ch is None:
            why = ('there is no text channel called #%s in this server'
                   % (desk_of(self.kind) or TICKETS_SAID))
            log(why)
        else:
            why = thread_block(guild, ch)
            if why:
                log('no ticket thread: %s' % why)
            else:
                try:
                    # Private, not invitable: only people the bot adds can
                    # read it. Roles with Manage Threads on this channel
                    # (Lead Gamemaster and Trial Gamemaster, per the note
                    # on is_staff) can still open a private thread. That
                    # is Discord's permission, not something this bot sets.
                    opened = await ch.create_thread(
                        name=title,
                        type=discord.ChannelType.private_thread,
                        invitable=False,
                        auto_archive_duration=10080)
                except Exception as e:
                    why = 'Discord refused to open the thread (%s)' % e
                    log('the ticket thread could not be created:\n'
                        + traceback.format_exc())
                    opened = None

        # From here the thread exists. Everything after it is allowed to fail
        # on its own without throwing the thread away, which is what used to
        # happen: one member who could not be added took the whole ticket down
        # and left an empty thread nobody was in.
        if opened is not None:
            remember_ticket(guild, who, opened)
            try:
                await opened.add_user(who)
            except Exception as e:
                log('could not add %s to their own ticket: %s' % (who, e))

            added = 0
            seen = set()
            for r in staff_roles:
                for m in r.members:
                    if m.id == who.id or m.id in seen or m.bot:
                        continue
                    seen.add(m.id)
                    try:
                        await opened.add_user(m)
                        added += 1
                    except Exception as e:
                        log('could not add %s to the ticket thread: %s' % (m, e))

            if staff_roles and added == 0:
                log('staff roles %r matched but nobody was added to the ticket '
                    'thread. If those roles have members, the bot is missing '
                    'permissions in #%s.'
                    % ([r.name for r in staff_roles], ch.name))

            try:
                # The head is ours and is the one post meant to ping: the
                # person who opened the ticket, and each staff role, by id.
                # Not @everyone, which nothing this bot writes ever says.
                await opened.send(head[:1900], view=TicketTools(),
                                  suppress_embeds=True,
                                  allowed_mentions=discord.AllowedMentions(
                                      everyone=False, users=True, roles=True))
                # Their words. Escaped above, with every mention switched
                # off here as well, and embeds suppressed so a bare link
                # cannot draw its preview. Anything the escaping misses
                # still pings nobody.
                for chunk in _chunks(shown, 1900):
                    await opened.send(chunk,
                                      suppress_embeds=True,
                                      allowed_mentions=discord.AllowedMentions.none())
                posted = True
            except Exception as e:
                why = 'the thread opened but nothing could be written in it (%s)' % e
                log('writing the ticket into the thread failed:\n'
                    + traceback.format_exc())
                # Faction Leader: a half-written private thread that
                # general staff cannot see, and that we then refuse, is
                # leftover. Delete this object, the one create_thread
                # just returned, never one looked up by name.
                if self.kind == 'faction':
                    try:
                        await opened.delete()
                    except Exception:
                        log('could not delete the half-written Faction '
                            'Leader thread:\n' + traceback.format_exc())
                    forget_ticket(guild, who, opened)

        # A ticket nobody can see is the same as no ticket, and a ticket
        # everybody can see is worse. If the thread could not be made, or could
        # not be written in, the whole ticket goes to the staff only log
        # channel instead, with the reason riding along so whoever reads it can
        # fix the cause without going to the VPS for a log.
        #
        # IT USED TO GO INTO THE PANEL CHANNEL, on the argument that the panel
        # channel was no more public than the thread. It was far more public. A
        # private thread is readable by the person who opened it and the staff
        # added to it; the panel channel is readable by everybody who can open
        # a ticket, which is the whole server. A report about somebody would go
        # up in front of the person it was about. From the To Do List: "A
        # reported member reading the report in the channel is a safety
        # problem, not a formatting one."
        #
        # log_channel checks the channel really is staff only before handing it
        # back. When there is no such channel, nothing goes into Discord at
        # all: the site inbox still gets the ticket below, and the person is
        # told by DM.
        fell_back = False
        # A Faction Leader ticket that has no private thread must not go
        # into #tickets or the site inbox: those are readable by general
        # staff. Refuse, tell the applicant to try again, and log it.
        # Other kinds keep the staff-only log fallback below.
        if not posted and self.kind == 'faction':
            log('Faction Leader ticket had no private thread%s. It was not written to the staff log or the site inbox.'
                % ((' (%s)' % why) if why else ''))
            try:
                await who.send(FACTION_THREAD_FAILED)
            except Exception as e:
                log('could not DM %s about the refused Faction Leader '
                    'ticket: %s' % (who, e))
        elif not posted:
            try:
                book = await log_channel(guild)
            except Exception:
                log('could not look for the staff only log channel:\n'
                    + traceback.format_exc())
                book = None
            if book is None:
                log('no staff only channel to put this ticket in, so Discord '
                    'has no copy of it. It goes to the site inbox only.')
            else:
                note = ''
                if why:
                    note = '\n_No private thread for this one: %s._' % why
                try:
                    # The display name in the title is theirs as well, so it
                    # is escaped here the way the answers are. The thread name
                    # above is a name rather than a post and keeps it as it is.
                    await book.send(
                        ('**%s**\n%s%s' % (as_typed(title, 96), head, note))[:1900],
                        suppress_embeds=True,
                        allowed_mentions=discord.AllowedMentions(
                            everyone=False, users=True, roles=True))
                    for chunk in _chunks(shown, 1900):
                        await book.send(chunk,
                                        suppress_embeds=True,
                                        allowed_mentions=discord.AllowedMentions.none())
                    fell_back = True
                except Exception:
                    log('the ticket could not be posted in #%s either:\n'
                        % book.name + traceback.format_exc())

        # And whatever happened in Discord, the person gets told something
        # true. The old wording promised a message that nothing ever sent.
        if not posted and not fell_back and self.kind != 'faction':
            try:
                await who.send(
                    'Your ticket reached staff, but Discord would not let the '
                    'bot open a thread for it. Nothing is lost: it is in the '
                    'staff inbox. Somebody will get back to you.')
            except Exception as e:
                log('could not even DM %s about the failed ticket: %s' % (who, e))

        # The site copy is bookkeeping, and nobody waits on it. It used to be
        # awaited here, before the reply, and push gives the site twelve
        # seconds to answer, so with the site down a stranger pressing Submit
        # watched the bot think for twelve seconds before hearing their ticket
        # was open. To Do List 253: "A spinner that sits for ten seconds reads
        # as broken to somebody who has never used the server, and the site
        # copy still lands." It is started here rather than after the replies
        # so that a reply Discord refuses cannot take the site copy with it.
        # push_async logs its own failure, so nothing is lost by not awaiting.
        # A Faction Leader ticket that never opened a thread is not sent:
        # the site inbox is readable by general staff.
        if posted or self.kind != 'faction':
            task = asyncio.create_task(push_async(
                self.kind, '%s: %s' % (self.label_text, who.display_name),
                detail, str(who), who.id, rules))
            _pushes.add(task)
            task.add_done_callback(_pushes.discard)

        if posted:
            await interaction.followup.send(
                'Opened %s. Everything else goes in there.' % opened.mention,
                ephemeral=True)
        elif self.kind == 'faction':
            await interaction.followup.send(FACTION_THREAD_FAILED, ephemeral=True)
        elif fell_back:
            await interaction.followup.send(
                'Sent. A private thread would not open, so it has gone straight '
                'to staff instead, somewhere only staff can read it. Somebody '
                'will answer you by message.',
                ephemeral=True)
        else:
            await interaction.followup.send(
                'Sent to staff. Discord would not let a thread open for it, so '
                'the answer will come by message rather than in here.',
                ephemeral=True)


def _chunks(s, n):
    while s:
        cut = s[:n]
        if len(s) > n:
            at = cut.rfind('\n')
            if at > n // 2:
                cut = s[:at]
        yield cut
        s = s[len(cut):].lstrip('\n')


def is_staff(who):
    """
    Somebody holding one of the STAFF_ROLES roles, matched by id or by name.
    The one gate on /close, the Close ticket button and the
    ticket limits, and the same list that pulls staff into every ticket
    thread except Faction Leader, which uses UPPER_STAFF_ROLES.

    Nothing else makes somebody staff here, a channel permission included.
    This used to let in anybody the channel trusted with threads as well, and
    Lead Gamemaster and Trial Gamemaster carry Manage Threads on every channel
    (GM in Build-Discord.py) while neither is a staff role, so both could
    close any ticket and skip the ticket limits without one (#1342).

    Content Creator is not staff. That role is added to creator application
    threads through EXTRA_STAFF and nowhere else. It does not close tickets,
    and it does not skip the one open ticket rule or the five minute cooldown.

    A person whose roles cannot be read is not staff.
    """
    try:
        return _who_hits(who, STAFF_IDS, STAFF_NAMES)
    except Exception:
        return False


# ------------------------------------------------------- one at a time --
# From the To Do List: "A public panel that auto-adds staff to every thread is
# otherwise a free way to ping every moderator fifty times a minute". One
# ticket is a thread, every member of every staff role added to it one at a
# time, a post that mentions them all and a row in the site inbox, and the
# panel sits in a channel everybody can see. Before this nothing counted any of
# it. So a person gets one open ticket at a time, and one new ticket every five
# minutes. Staff are held to neither.
TICKET_COOLDOWN = _int_env('TICKET_COOLDOWN', 300)

# When each person last sent one. In memory, so a restart forgets it, and that
# is fine for a cooldown. The one open ticket rule is the one that has to
# survive a restart, and it does not live here.
_last_ticket = {}

# Which thread is each person's open ticket. On disk beside the code, for the
# same reason as STAMP further down: the process restarts in a loop, and a rule
# that forgets on every restart is not a rule. The thread name cannot carry it,
# because the name is the label and a display name, and a display name is
# neither unique nor fixed.
OPEN_TICKETS = os.path.join(DATA_DIR, 'open-tickets.json')


def _now():
    return time.monotonic()


def _ticket_key(guild, who):
    return '%s:%s' % (getattr(guild, 'id', 0), who.id)


def _open_tickets():
    try:
        with open(OPEN_TICKETS) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _open_thread(guild, tid):
    """
    The thread, if it is still open, or None.

    get_thread reads the bot's own cache and asks Discord nothing, which
    matters on a click that has three seconds to be answered in. discord.py
    drops a thread from that cache the moment it is archived, and Close
    archives, so a closed ticket and a deleted one both come back None and
    the person is let through.
    """
    try:
        t = guild.get_thread(int(tid))
    except Exception:
        return None
    if t is None or getattr(t, 'archived', False):
        return None
    return t


def remember_ticket(guild, who, thread):
    """
    Write down that this thread is this person's open ticket.

    Entries for threads that are no longer open are dropped on the way, so the
    file stays the size of the queue rather than the size of everybody who
    ever asked for anything.
    """
    try:
        mine = '%s:' % getattr(guild, 'id', 0)
        keep = {}
        for k, v in _open_tickets().items():
            if k.startswith(mine) and _open_thread(guild, v) is None:
                continue
            keep[k] = v
        keep[_ticket_key(guild, who)] = thread.id
        with open(OPEN_TICKETS, 'w') as f:
            json.dump(keep, f)
    except Exception:
        log('could not write down which ticket %s has open, so they can open '
            'a second one:\n' % who + traceback.format_exc())


def forget_ticket(guild, who, thread):
    """
    Drop this thread from the open-ticket file, if it is still the one
    written. Used when a Faction Leader thread is deleted in the same
    submit that created it, so the person is not held to a ticket that
    no longer exists. Matches on the thread's id, never its name.
    """
    try:
        key = _ticket_key(guild, who)
        have = _open_tickets()
        if have.get(key) != getattr(thread, 'id', None):
            return
        have.pop(key, None)
        with open(OPEN_TICKETS, 'w') as f:
            json.dump(have, f)
    except Exception:
        log('could not forget the half-written ticket for %s:\n'
            % who + traceback.format_exc())


def ticket_refusal(interaction):
    """
    Why this person cannot open a ticket right now, in words, or None.

    Asked twice: when somebody picks from the panel, so they hear it before
    typing anything, and again when the form comes back, because the form can
    be opened several times before any of them is sent.

    Anything that goes wrong in here lets them through. A bug that refused
    every ticket would refuse every playtest application with it, and that is
    the only way in.
    """
    try:
        who = interaction.user
        guild = interaction.guild
        if guild is None or is_staff(who):
            return None
        key = _ticket_key(guild, who)
        tid = _open_tickets().get(key)
        t = _open_thread(guild, tid) if tid else None
        if t is not None:
            return ('You already have a ticket open: %s. Say it in there and '
                    'staff will see it.' % t.mention)
        at = _last_ticket.get(key)
        if at is not None:
            left = TICKET_COOLDOWN - (_now() - at)
            if left > 0:
                mins = int((left + 59) // 60)
                return ('You have only just sent a ticket. You can send '
                        'another in %d minute%s.'
                        % (mins, '' if mins == 1 else 's'))
        return None
    except Exception:
        log('the ticket limit could not be checked, so this one was let '
            'through:\n' + traceback.format_exc())
        return None


def is_ticket_thread(ch):
    """
    True for a thread a ticket opened: one off a channel named in
    TICKET_DESKS or TICKET_CHANNEL, the only places TicketModal opens one. A ticket
    that could not have its thread goes into the TICKET_LOG channel as a
    plain message, never a thread, so that channel has none to close.

    This used to be any thread at all (#1776). /close in a Live smoke session
    thread (since removed) or a #tales post archived and locked it and wrote "Closed: ..."
    into the staff ticket record as if it were a ticket.

    A thread whose parent is not in the bot's cache is not a ticket here:
    refusing a close costs nothing, since staff can still archive a thread by
    hand.
    """
    if not isinstance(ch, discord.Thread):
        return False
    name = getattr(ch.parent, 'name', None)
    return bool(name) and name.lower() in TICKET_NAMES


def faction_leader_label():
    for k, lab, _d in KINDS:
        if k == 'faction':
            return lab
    return 'Apply: Faction Leader'


def is_faction_leader_thread(ch):
    """
    A ticket thread TicketModal opened for Apply: Faction Leader.

    The name starts with that label because that is what on_submit writes.
    Used only to decide who may /close this kind. is_staff is not changed.
    """
    if not is_ticket_thread(ch):
        return False
    label = faction_leader_label()
    name = getattr(ch, 'name', None) or ''
    return bool(label) and name.startswith(label)


def holds_upper_staff(who):
    """A role whose ID is in UPPER_STAFF_ROLES. Names are ignored."""
    try:
        return _who_hits(who, UPPER_STAFF_IDS, set())
    except Exception:
        return False


def can_close_ticket(who, ch):
    """
    Staff close every ticket. On a Faction Leader thread, a member whose
    role ID is in UPPER_STAFF_ROLES may close it too. is_staff itself is
    not changed: ticket limits and cooldowns still answer to that.
    """
    if is_staff(who):
        return True
    return is_faction_leader_thread(ch) and holds_upper_staff(who)


async def close_here(interaction, why=None):
    """
    Close the ticket this was used in.

    Archived and locked rather than deleted. A ticket is the record of what
    somebody was told and when, and the one time anybody goes looking for it
    is the argument afterwards, so nothing here removes anything. Locked means
    it takes a staff member to open it again, not a stray message. It is
    deleted TICKET_KEEP_DAYS after it closes, by watch_closed_tickets and not
    here (#2353).

    Only in a ticket's own thread (is_ticket_thread), refused before anything
    is said, archived or written down.
    """
    ch = interaction.channel
    if not is_ticket_thread(ch):
        await interaction.response.send_message(
            'This one only works inside a ticket.', ephemeral=True)
        return

    # is_staff is unchanged and still gates every other ticket, the
    # one-open-ticket rule and the cooldown. Faction Leader threads
    # also let through a member whose role ID is in UPPER_STAFF_ROLES.
    if not can_close_ticket(interaction.user, ch):
        await interaction.response.send_message(
            'Staff close these. Say what you need in here and somebody will.',
            ephemeral=True)
        return

    line = 'Closed by %s.' % interaction.user.mention
    if why:
        line += ' ' + why.strip()
    line += ('\nEverybody who was in here can still read it, and staff can open '
             'it again. It is deleted %d days after it was last closed.'
             % TICKET_KEEP_DAYS)
    await interaction.response.send_message(line[:1900])

    # Archiving drops a thread out of the sidebar and out of the channel's
    # active list, and a private one is then behind two clicks nobody finds. A
    # closed ticket nobody can find again is barely better than a lost one, so
    # a line is written down somewhere searchable with a link straight back to
    # it. Somewhere being the staff channel, not the one people apply in.
    try:
        book = await log_channel(interaction.guild)
        if book is not None:
            note = 'Closed: **%s**. By %s.' % (
                ch.name, interaction.user.display_name)
            if why:
                note += ' ' + why.strip()
            note += '\n' + ch.jump_url
            await book.send(note[:1900])
    except Exception:
        log('could not write the ticket down:\n' + traceback.format_exc())

    # Sent first, then archived. The other way round the message never lands,
    # because an archived thread will not take one.
    try:
        await ch.edit(archived=True, locked=True)
    except Exception:
        try:
            await ch.edit(archived=True)
        except Exception:
            log('could not archive the ticket thread:\n' + traceback.format_exc())


class TicketTools(discord.ui.View):
    """Sits on the ticket's first message. Persistent, so it still works after
       the bot restarts rather than going dead the moment anything updates."""
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label='Close ticket', style=discord.ButtonStyle.secondary,
                       custom_id='thornswood:close')
    async def close(self, interaction, button):
        await close_here(interaction)


@tree.command(name='close', description='Close this ticket. Staff only.')
@discord.app_commands.describe(why='Optional. What was decided.')
async def close_cmd(interaction: discord.Interaction,
                    why: typing.Optional[str] = None):
    await close_here(interaction, why)


# HOW LONG A CLOSED TICKET IS KEPT (#2353). Closing archived and locked the
# thread and nothing ever deleted it, so it was the one store with no keeping
# time. Decided by Patrick on 19 Oct: the bot deletes a ticket thread
# TICKET_KEEP_DAYS after it closes, the same 365 days the site keeps its copy
# of the application (INBOX_DAYS in site/server.js). Discord cannot undo it.
#
# When it closed is Discord's own archive_timestamp, not a record of ours. It
# is set for every archived thread, so the tickets closed before this was
# written are aged too, and so is one staff archived by hand. Opening a ticket
# again and closing it moves the time on, so the year starts over. A ticket
# nobody closed is archived by Discord after a week with nothing said in it
# (auto_archive_duration in TicketModal), and the bot already counts it as
# closed: _open_thread lets its person open another. So it ages from then.
#
# Only threads the bot opened off a TICKET_CHANNEL channel: a private thread
# a Gamemaster opened there by hand (see the note in TicketModal) is not a
# ticket and is never touched.
TICKET_KEEP_DAYS = 365
TICKET_KEEP_EVERY = 60 * 60


def ticket_past_keeping(thread, bot_id, cut):
    """
    True when this thread is a ticket the bot opened, archived, and archived
    before cut, an aware datetime. A thread whose close time is not an aware
    datetime, or whose opener cannot be read, is kept rather than guessed at.
    """
    if bot_id is None or getattr(thread, 'owner_id', None) != bot_id:
        return False
    if getattr(thread, 'archived', None) is not True:
        return False
    at = getattr(thread, 'archive_timestamp', None)
    if not isinstance(at, datetime.datetime) or at.tzinfo is None:
        return False
    return at < cut


async def age_closed_tickets(guild, bot_id, now):
    """
    Deletes this server's ticket threads closed more than TICKET_KEEP_DAYS
    before now, and returns (deleted, failed). Each one deleted is a line in
    bot.log with its id and when it closed; the staff record's Closed line
    carries the same id in its link. A list that cannot be read, or a delete
    Discord refuses, is a line with Discord's reason, and that thread stays
    until the next pass.
    """
    cut = now - datetime.timedelta(days=TICKET_KEEP_DAYS)
    deleted = failed = 0
    for ch in getattr(guild, 'text_channels', []):
        if (getattr(ch, 'name', '') or '').lower() not in TICKET_NAMES:
            continue
        due = []
        try:
            # Discord lists them newest closed first and, given before, only
            # those closed before it. ticket_past_keeping still checks each.
            async for t in ch.archived_threads(private=True, limit=None,
                                               before=cut):
                if ticket_past_keeping(t, bot_id, cut):
                    due.append(t)
        except Exception as e:
            failed += 1
            log('closed tickets: could not list the closed threads in #%s of '
                '"%s", so none of them was deleted this pass: %s: %s'
                % (ch.name, guild.name, type(e).__name__, e))
            continue
        for t in due:
            try:
                await t.delete()
            except Exception as e:
                failed += 1
                log('closed tickets: could not delete thread %s in #%s, closed '
                    '%s: %s: %s' % (t.id, ch.name,
                                    t.archive_timestamp.date().isoformat(),
                                    type(e).__name__, e))
                continue
            deleted += 1
            log('closed tickets: deleted thread %s in #%s, closed %s, more '
                'than %d days ago' % (t.id, ch.name,
                                      t.archive_timestamp.date().isoformat(),
                                      TICKET_KEEP_DAYS))
    return deleted, failed


# THE STAFF TICKET LOG IS KEPT THE SAME 365 DAYS (#3634). The bot writes two
# things into the TICKET_LOG channel: a whole ticket whose private thread
# would not open (its title with the opener's name, the opener's mention and
# every answer they typed), and a Closed line naming the thread, which is the
# opener's name, at every close. age_closed_tickets deletes the threads and
# never read this channel, so those copies had no keeping time while the
# privacy page said a ticket goes after 365 days. Each of the bot's own
# messages there now goes TICKET_KEEP_DAYS after it was posted: a fallback
# ticket the same year as a ticket in a thread, and a Closed line the same
# year as the thread it points at, which is deleted a year after that close.
# Only the bot's own messages, and never in a channel tickets open off, so a
# panel is never touched if TICKET_LOG is ever pointed at one.
async def age_ticket_log(guild, bot_id, now):
    """
    Deletes the bot's own messages in this server's TICKET_LOG channels that
    were posted more than TICKET_KEEP_DAYS before now, and returns (deleted,
    failed). Said in bot.log as counts a channel, never what a message said.
    A history that cannot be read, or a delete Discord refuses, is a line
    with Discord's reason, and the message stays until the next pass.
    """
    if bot_id is None:
        return 0, 0
    cut = now - datetime.timedelta(days=TICKET_KEEP_DAYS)
    deleted = failed = 0
    for ch in getattr(guild, 'text_channels', []):
        name = (getattr(ch, 'name', '') or '').lower()
        if name not in TICKET_LOG or name in TICKET_NAMES:
            continue
        due = []
        try:
            async for m in ch.history(limit=None, before=cut):
                at = getattr(m, 'created_at', None)
                if (getattr(getattr(m, 'author', None), 'id', None) == bot_id
                        and isinstance(at, datetime.datetime)
                        and at.tzinfo is not None and at < cut):
                    due.append(m)
        except Exception as e:
            failed += 1
            log('ticket log: could not read #%s of "%s", so none of it was '
                'deleted this pass: %s: %s'
                % (ch.name, guild.name, type(e).__name__, e))
            continue
        gone = 0
        for m in due:
            try:
                await m.delete()
            except Exception as e:
                failed += 1
                log('ticket log: could not delete message %s in #%s, posted '
                    '%s: %s: %s' % (m.id, ch.name, m.created_at.date().isoformat(),
                                    type(e).__name__, e))
                continue
            gone += 1
        if gone:
            deleted += gone
            log('ticket log: deleted %d of the bot\'s messages in #%s posted '
                'more than %d days ago' % (gone, ch.name, TICKET_KEEP_DAYS))
    return deleted, failed


async def watch_closed_tickets():
    """
    Runs age_closed_tickets and age_ticket_log on every server as the bot
    comes up and every TICKET_KEEP_EVERY seconds, like watch_join_numbers.
    Nothing in here may end the loop: a pass that fails is said in bot.log,
    and the threads and messages it did not reach are there for the next one.
    """
    await client.wait_until_ready()
    while not client.is_closed():
        now = datetime.datetime.now(datetime.timezone.utc)
        bot_id = getattr(client.user, 'id', None)
        for gd in list(client.guilds):
            for age in (age_closed_tickets, age_ticket_log):
                try:
                    await age(gd, bot_id, now)
                except Exception:
                    log('closed tickets: the %s pass on "%s" stopped part way, '
                        'so what it did not reach waits for the next one:\n%s'
                        % (age.__name__, gd.name, traceback.format_exc()))
        await asyncio.sleep(TICKET_KEEP_EVERY)


class TicketPanel(discord.ui.View):
    """One desk's panel (TICKET_DESKS), offering only its kinds, or with desk
       None the one panel of before the split, offering every kind. A desk
       with no kind to offer today (the playtest one while the world is
       open) is its words alone."""

    def __init__(self, desk=None):
        super().__init__(timeout=None)
        if desk_kinds(desk):
            self.add_item(TicketPicker(desk))


def desk_kinds(desk):
    """The KINDS a desk's panel offers, in KINDS' order; every one for None."""
    if desk is None:
        return list(KINDS)
    want = dict(TICKET_DESKS).get(desk, ())
    return [k for k in KINDS if k[0] in want]


class TicketPicker(discord.ui.Select):
    def __init__(self, desk=None):
        super().__init__(
            # A custom_id of its own a desk, so a press on any posted panel
            # is answered after a restart; the one of before keeps its own.
            custom_id='thornswood:ticket' + ('' if desk is None else ':' + desk),
            placeholder='What do you need?',
            options=[discord.SelectOption(label=lab, value=k, description=desc[:100])
                     for k, lab, desc in desk_kinds(desk)])

    async def callback(self, interaction):
        # Told here, before the form opens, so nobody types out a whole
        # application only to be turned away at the end of it.
        k = self.values[0]
        no = (ticket_refusal(interaction) or
              seat_refusal(k, interaction.user, interaction.guild))
        if no:
            await interaction.response.send_message(no, ephemeral=True)
            return
        lab = dict((a, b) for a, b, _ in KINDS)[k]
        await interaction.response.send_modal(TicketModal(k, lab, interaction.guild))


_PANEL_THREAD = ('It asks a few questions, then opens a thread only you and staff '
                 'can see. Nothing here is public and nobody else in the server '
                 'can read it.')
_PANEL_TOP = ('**Open a ticket**\n\n'
              'Pick the one that fits. ' + _PANEL_THREAD + '\n\n')
_PANEL_SEATS = ('**Apply: Jarl** and **Apply: Faction Leader** are '
                'answered in character, and list only the seats nobody holds. A '
                'Jarl is a faction leader with an application of its own, because '
                'a hold is a seat like no other. A faction has one leader. ' +
                STAFF_LEADERSHIP_RULE + ' Somebody who holds a seat cannot apply '
                'for staff either.')
_PANEL_ANSWER = 'Applying for one does not give you it. Somebody reads it and answers.'
_PANEL_JOBS = (_PANEL_SEATS + '\n\n'
               'The jobs below that are open to anybody already in, and they are jobs '
               'rather than titles: each one is work somebody is currently doing '
               'instead of you.\n\n' + _PANEL_ANSWER)
_PANEL_PLAY_ALPHA = ('Thornswood is in alpha, and the world is open by application. Anyone '
                     'can download it. **Apply to be an alpha playtester** is the one '
                     'everybody starts with: once it is accepted you get the Playtester '
                     'role, and that is what lets you press Play. It asks whether you are '
                     '18 or over and whether you accept the rules, so read #rules first. '
                     'Your answers are kept against your Discord account.')
_PANEL_PLAY_OPEN = ('Thornswood is open: anyone in the Discord can play, so there is '
                    'nothing to apply for to get in. Read #rules, because being here '
                    'and in the world means accepting them.')
PANEL_ALPHA = _PANEL_TOP + _PANEL_PLAY_ALPHA + '\n\n' + _PANEL_JOBS
PANEL_OPEN = _PANEL_TOP + _PANEL_PLAY_OPEN + '\n\n' + _PANEL_JOBS
PANEL = PANEL_ALPHA


def desk_panel(desk):
    """A desk's words, for the world as it is now (OPEN); PANEL for None."""
    if desk == 'get-help':
        return ('**Get help**\n\n'
                'It will not install, will not start or will not connect, or '
                'something else is wrong that staff can fix. Pick **I need help** '
                'below. ' + _PANEL_THREAD)
    if desk == 'report-someone':
        return ('**Report somebody**\n\n'
                'Something happened and it should not have. Pick **Report '
                'somebody** below. ' + _PANEL_THREAD + ' The person you report '
                'never sees it.')
    if desk == 'apply-to-playtest':
        if OPEN:
            return '**Apply to play**\n\n' + _PANEL_PLAY_OPEN
        return '**Apply to play**\n\n' + _PANEL_PLAY_ALPHA + ' ' + _PANEL_THREAD
    if desk == 'apply-for-a-seat':
        return ('**Apply for a seat**\n\n' + _PANEL_SEATS + '\n\n' + _PANEL_THREAD +
                '\n\n' + _PANEL_ANSWER)
    if desk == 'apply-for-staff':
        return ('**Apply for staff**\n\n'
                'These are jobs rather than titles: each one is work somebody is '
                'currently doing instead of you. Somebody who holds a Jarl seat or '
                'leads a faction cannot apply. ' + _PANEL_THREAD + '\n\n' + _PANEL_ANSWER)
    return PANEL

# THE ONE SWITCH (#428), read off the site so there is one copy of it: the
# site's config.json "open", which /api/public hands out. Off, which is today,
# the panel is the alpha one above and the application asks the age and rules
# questions. On, anybody in the Discord can play, so the application goes from
# the panel, and with it the age and rules questions, which were only ever
# asked on the way in. THORNSWOOD_OPEN in bot.env.json overrides the site, for
# a dev bot or a site that is down. Read once, in setup_hook, before the panel
# view is registered; flipping it means restarting the bot.
KINDS_ALPHA = list(KINDS)
OPEN = False


def site_open():
    """Whether the world is open to everybody, from THORNSWOOD_OPEN when it is
       set and otherwise from the site. Anything that goes wrong answers no,
       the alpha, which is what is true until somebody flips the switch."""
    env = os.environ.get('THORNSWOOD_OPEN', '').strip().lower()
    if env in ('1', 'true', 'yes', 'open'):
        return True
    if env in ('0', 'false', 'no', 'alpha', 'closed'):
        return False
    try:
        with urllib.request.urlopen(SITE + '/api/public', timeout=8) as r:
            return json.loads(r.read().decode('utf-8')).get('open') is True
    except Exception as e:
        log('could not ask the site whether the world is open, so the panel is '
            'the alpha one:', e)
        return False


#
# THE STATUS LINES (#3147). The bot's status, under its name in the member
# list, is one of Thornswood's hints and lore lines, a new one every
# LINES_EVERY seconds. Their one copy is site\data\site\lines.md; the site
# hands them out in /api/public as "lines", read here at every change, so a
# line edited there reaches the bot once its merge's Release is on the site
# (the deploy agent, #5190), with no bot install. Hints and lore lines take turns, each list in its own order.
LINES_EVERY = 15 * 60


def status_lines(lines):
    """The lines the status steps through: a hint, then a lore line, in turn,
       until both lists are used up. A lore line is its quote alone; its source
       does not fit in a status."""
    lines = lines if isinstance(lines, dict) else {}
    hints = [h for h in (lines.get('hints') or []) if isinstance(h, str) and h]
    lore = [x.get('text') for x in (lines.get('lore') or [])
            if isinstance(x, dict) and isinstance(x.get('text'), str) and x.get('text')]
    out = []
    for i in range(max(len(hints), len(lore))):
        out.extend(([hints[i]] if i < len(hints) else []) + ([lore[i]] if i < len(lore) else []))
    return out


def site_lines():
    """The status lines from the site's /api/public. Raises when the site
       cannot be read, for watch_lines to say."""
    with urllib.request.urlopen(SITE + '/api/public', timeout=8) as r:
        return status_lines(json.loads(r.read().decode('utf-8')).get('lines'))


async def watch_lines():
    """
    Sets the status to the next line every LINES_EVERY seconds. When the site
    cannot be read, or hands out no lines, that is said in bot.log and the
    status stays as it is until the next pass. Nothing in here may end the
    loop.
    """
    await client.wait_until_ready()
    at = 0
    while not client.is_closed():
        try:
            texts = await asyncio.get_running_loop().run_in_executor(None, site_lines)
            if texts:
                await client.change_presence(
                    activity=discord.CustomActivity(name=texts[at % len(texts)]))
                at += 1
            else:
                log('status lines: the site handed out none, so the status '
                    'stays as it is until the next pass')
        except Exception:
            log('status lines: could not set the next one, so the status stays '
                'as it is until the next pass:\n' + traceback.format_exc())
        await asyncio.sleep(LINES_EVERY)


def set_open(on):
    """Point the panel, its kinds and the age and rules questions at one mode."""
    global OPEN, KINDS, AGE_KINDS, RULES_KINDS, PANEL
    OPEN = on is True
    KINDS = [k for k in KINDS_ALPHA if not (OPEN and k[0] == 'playtest')]
    AGE_KINDS = () if OPEN else ('playtest',)
    RULES_KINDS = AGE_KINDS
    PANEL = PANEL_OPEN if OPEN else PANEL_ALPHA


def _panel_options(msg):
    """
    The value and label of every option the POSTED dropdown is offering.

    Read off the message rather than off KINDS, because the two are exactly
    what can drift: the options a dropdown offers live in the message that was
    posted, not in the View this process builds on startup.

    An empty list when the components cannot be read, which does not match the
    wanted list, so the panel is edited. That is the right way round to fail:
    an edit nobody needed costs one audit log line, and a kind that never
    appears costs somebody a ticket they cannot open.
    """
    pairs = []
    try:
        for row in getattr(msg, 'components', None) or []:
            for item in getattr(row, 'children', None) or []:
                for o in getattr(item, 'options', None) or []:
                    pairs.append((getattr(o, 'value', ''), getattr(o, 'label', '')))
    except Exception:
        return []
    return pairs


def _panel_wanted(desk=None):
    return [(k, lab) for k, lab, _ in desk_kinds(desk)]


def panel_is_current(msg, desk=None):
    """
    True when the posted panel already says what it should, text and options.

    Its own function so it can be run without a Discord to run it against:
    bot/tests/test-ready.py drives it with a made up message. The decision
    is the part worth pinning, because getting it wrong in either direction is
    a real fault: too eager and the panel is edited on every reconnect, too
    lazy and a ticket kind added later never appears for anybody.
    """
    return (getattr(msg, 'content', None) == desk_panel(desk)
            and _panel_options(msg) == _panel_wanted(desk))


# Which servers staff have been told cannot open ticket threads, and why, so
# a reconnect does not tell them again.
_told_blocked = set()


async def ensure_panel(guild):
    """Every desk's panel (TICKET_DESKS), current, in its own channel. On a
       server not yet split, the one panel of before in TICKETS; where that
       channel is still there beside the desks, its panel says where they
       went (#3317, q-3317-ticket-split)."""
    desks = [(d, by_name(guild, [d])) for d, _k in TICKET_DESKS]
    here = [(d, ch) for d, ch in desks if ch is not None]
    old = by_name(guild, TICKETS)
    if not here and old is None:
        names = ', '.join('#' + c.name for c in guild.text_channels) or 'none'
        log('there is no ticket channel in "%s": none of #%s, and no #%s, so there '
            'is no panel and no tickets. Text channels there: %s. Build-Discord.py '
            'makes them.' % (guild.name, ', #'.join(d for d, _k in TICKET_DESKS),
                             TICKETS_SAID, names))
        return

    book = await log_channel(guild)
    if book is not None:
        log('closed tickets are written down in #%s' % book.name)

    if not here:
        await desk_ready(guild, old, None, book)
        return
    gone = [d for d, ch in desks if ch is None]
    if gone:
        log('there is no #%s in "%s", so those tickets have nowhere to open. '
            'Build-Discord.py makes them.' % (', #'.join(gone), guild.name))
    for d, ch in here:
        await desk_ready(guild, ch, d, book)
    if old is not None:
        await point_old_panel(old, here)


async def desk_ready(guild, ch, desk, book):
    """One desk's channel: who cannot use /close there, whether a private
       thread can be opened in it, and its panel posted or made current."""
    # Said at startup rather than the first time somebody applies, because the
    # first time somebody applies is the worst moment to find out.
    # Slash commands are a permission of their own, and it is granted per
    # channel. The server owner bypasses every overwrite, so /close looked
    # fine to the one person who could never have been blocked by it while
    # staff saw nothing at all. Named here rather than left to be discovered.
    # Read from the cache with no request, so nothing here waits on Discord or
    # throws: it is no longer in a try that dropped any error unsaid (#2736).
    blocked = []
    for r in guild.roles:
        if not (_role_hit(r, STAFF_IDS, STAFF_NAMES)
                or _role_hit(r, CREATOR_IDS, CREATOR_NAMES)):
            continue
        if not getattr(ch.permissions_for(r), 'use_application_commands', True):
            blocked.append(r.name)
    if blocked:
        log('%s cannot use /close in #%s: Use Application Commands is off '
            'for them there. Turn it on in that channel\'s permissions. The '
            'Close button on the ticket works for them either way.'
            % (', '.join(blocked), ch.name))

    why = thread_block(guild, ch)
    if why:
        if book is not None:
            where = '#%s, which only staff can read' % book.name
        else:
            where = ('the site inbox and nowhere in Discord, because there is '
                     'no staff only channel to put it in')
        fix = ('%s. Tick it in that channel\'s permissions, or on the bot\'s '
               'role server wide. Until then every ticket goes to %s.'
               % (why, where))
        log('tickets in "%s" will NOT get a private thread: %s' % (guild.name, fix))

        # Said in the staff channel too, because the log is on the VPS and
        # nobody reads it until something is already wrong. Once per process:
        # this runs on every reconnect, and a flaky evening would say it ten
        # times.
        #
        # THE PANEL STAYS UP. The To Do List asked for the bot to refuse to
        # start here, "so the permission gets fixed before a stranger finds
        # out". With the fallback staff only there is nothing left for a
        # stranger to find. Refusing would not take the panel down either: the
        # posted one keeps answering through the view setup_hook registers.
        # All it would do is take away the one way to report somebody, on the
        # night that way is broken.
        if (guild.id, ch.name, why) not in _told_blocked:
            _told_blocked.add((guild.id, ch.name, why))
            await trouble_say('**Tickets cannot open a private thread:** ' + fix)
    else:
        log('ticket threads look fine in #%s' % ch.name)

    try:
        head = desk_panel(desk).split('\n', 1)[0]
        async for m in ch.history(limit=30):
            # Its words alone when it has no kind to offer, so found by its
            # first line as well as by a dropdown.
            if m.author.id == client.user.id and (
                    m.components or (m.content or '').startswith(head)):
                # The options a dropdown offers live in the message that was
                # posted, not in the View this process builds on startup. So
                # leaving the old message alone is exactly why a ticket kind
                # added later never appeared for anybody: the code had it, the
                # message did not. Editing in place keeps the same message and
                # its spot in the channel and puts the current list on it.
                #
                # BUT ONLY WHEN THERE IS SOMETHING TO CHANGE. This ran on every
                # reconnect, so a flaky evening was a stream of edits to the
                # same message, each one an entry in the audit log and a write
                # against the rate limit the bot is already fighting. The text
                # and the option list are compared first, and both are
                # compared: comparing the text alone puts back the bug above,
                # where a kind added later never appeared because the words
                # around it had not changed.
                if panel_is_current(m, desk):
                    log('ticket panel is already current in #%s' % ch.name)
                    return
                await m.edit(content=desk_panel(desk), view=TicketPanel(desk))
                log('ticket panel updated in #%s' % ch.name)
                return
        await ch.send(desk_panel(desk), view=TicketPanel(desk))
        log('ticket panel posted in #%s' % ch.name)
    except Exception:
        log('panel failed:\n' + traceback.format_exc())




MOVED_HEAD = '**Tickets have moved**'


def moved_text(here):
    return (MOVED_HEAD + '\n\nEvery kind of ticket has a channel of its own now: ' +
            ', '.join(ch.mention for _d, ch in here) + '. Open yours there. A '
            'ticket already open here stays open until staff close it.')


async def point_old_panel(old, here):
    """The one panel of before, in a channel the desks replaced and -Prune has
       not deleted yet: its dropdown taken off, and where each desk is said.
       A ticket thread still open off it keeps working."""
    text = moved_text(here)
    try:
        async for m in old.history(limit=30):
            if m.author.id != client.user.id:
                continue
            if m.content == text and not m.components:
                return
            if m.components or (m.content or '').startswith(MOVED_HEAD):
                await m.edit(content=text, view=None)
                log('the old panel in #%s now says where the tickets went' % old.name)
                return
    except Exception:
        log('the old panel in #%s could not be changed:\n' % old.name
            + traceback.format_exc())


# ------------------------------------------------------ holds and pings --
#
# #choose-your-hold, where a Member picks the hold their character calls home
# and which announcements they want a ping for.
#
# The hold channels are private: each hold's category is open to its own
# Citizen, Jarl and officers and to staff, so picking a hold here is what
# opens it. One
# hold per person. Picking another takes the old Citizen role away, and
# pressing the one you already have leaves it. Jarl roles are never touched
# here; a Jarl is appointed, not picked.
#
# Only somebody with the Member role, or a staff role, can use it. The channel
# is hidden from everybody else already, and this is the second lock, so a
# button reached some other way still does nothing for somebody not yet in.
#
# The two ping roles are made if they are missing, and made not mentionable,
# so only staff who can already mention everyone can ping them.
HOLD_CHANNEL = [n.strip().lower() for n in
                os.environ.get('HOLD_CHANNEL', 'choose-your-hold').split(',')
                if n.strip()]
MEMBER_ROLE = os.environ.get('MEMBER_ROLE', 'Member').strip().lower()
MEMBER_IDS, MEMBER_NAMES = _role_tokens([MEMBER_ROLE] if MEMBER_ROLE else [])
# Raven Rock is a hold like the nine since #3317 (Patrick, 22 Oct, page card
# q-3317-raven-rock, A), last, on a row of its own on the panel.
HOLDS = ['Whiterun', 'Solitude', 'Windhelm', 'Riften', 'Markarth',
         'Dawnstar', 'Morthal', 'Falkreath', 'Winterhold', 'Raven Rock']
# key, role name, button label
PINGS = [('news', 'News Pings', 'News pings'),
         ('updates', 'Updates Pings', 'Updates pings')]

HOLD_PANEL = ('**Choose your hold**\n\n'
              'Pick the hold your character calls home and its channels open '
              'to you. One hold at a time: picking another moves you there, '
              'and pressing the one you have leaves it.\n\n'
              '**Pings**\n\n'
              'News pings you when a release goes out in #news. Updates pings '
              'you for restarts and notices in #updates. Press either again '
              'to stop.')


def _citizen(hold):
    return 'Citizen of ' + hold


def _role(guild, name):
    want = name.lower()
    for r in guild.roles:
        if r.name.lower() == want:
            return r
    return None


def _may_pick(member):
    return (_who_hits(member, MEMBER_IDS, MEMBER_NAMES)
            or _who_hits(member, STAFF_IDS, STAFF_NAMES))


def _can_give(guild, role):
    """
    Discord refuses a role at or above the bot's own highest role with a
    Forbidden and nothing else, so it is checked first and said in words.
    """
    me = guild.me
    return bool(me.guild_permissions.manage_roles) and role < me.top_role


async def _say(interaction, text):
    await interaction.response.send_message(text, ephemeral=True)


async def pick_hold(interaction, hold):
    guild, who = interaction.guild, interaction.user
    if guild is None or not _may_pick(who):
        await _say(interaction, 'Holds open once your application is approved '
                                'and you have the Member role.')
        return
    role = _role(guild, _citizen(hold))
    if role is None or not _can_give(guild, role):
        log('cannot give %s: the role is missing, or the bot has no Manage '
            'Roles, or its own role is not above it.' % _citizen(hold))
        await _say(interaction, 'That hold cannot be given out right now. Ask '
                                'staff to give it to you.')
        return
    try:
        if role in who.roles:
            await who.remove_roles(role, reason='Left their hold in #choose-your-hold')
            await _say(interaction, 'You are no longer a citizen of %s.' % hold)
            return
        old = [r for r in who.roles
               if r.name.lower().startswith('citizen of ') and r != role
               and _can_give(guild, r)]
        if old:
            await who.remove_roles(*old, reason='Moved hold in #choose-your-hold')
        await who.add_roles(role, reason='Picked in #choose-your-hold')
        said = 'You are now a citizen of %s. Its channel is open to you.' % hold
        if old:
            said += ' You are no longer a citizen of %s.' % ', '.join(
                r.name[len('Citizen of '):] for r in old)
        await _say(interaction, said)
    except Exception:
        log('hold pick failed:\n' + traceback.format_exc())
        await _say(interaction, 'That did not go through. Try again, or ask staff.')


async def toggle_ping(interaction, name):
    guild, who = interaction.guild, interaction.user
    if guild is None or not _may_pick(who):
        await _say(interaction, 'Pings open once your application is approved '
                                'and you have the Member role.')
        return
    role = _role(guild, name)
    if role is None or not _can_give(guild, role):
        log('cannot give %s: the role is missing, or the bot has no Manage '
            'Roles, or its own role is not above it.' % name)
        await _say(interaction, 'Pings cannot be changed right now. Ask staff.')
        return
    try:
        if role in who.roles:
            await who.remove_roles(role, reason='Turned off in #choose-your-hold')
            await _say(interaction, '%s off.' % name)
        else:
            await who.add_roles(role, reason='Turned on in #choose-your-hold')
            await _say(interaction, '%s on.' % name)
    except Exception:
        log('ping toggle failed:\n' + traceback.format_exc())
        await _say(interaction, 'That did not go through. Try again, or ask staff.')


class HoldButton(discord.ui.Button):
    def __init__(self, hold, row):
        super().__init__(label=hold, style=discord.ButtonStyle.secondary,
                         custom_id='thornswood:hold:' + hold.lower(), row=row)
        self.hold = hold

    async def callback(self, interaction):
        await pick_hold(interaction, self.hold)


# THE PANEL'S ROWS (#3317, Patrick, 22 Oct: "These button layouts also need
# fixed"). Five holds to a row wrapped on a phone, four and then Markarth on
# its own, three and then Winterhold on its own. Three to a row fits a phone
# and reads as a block on a desktop: nine holds in three rows of three, and
# the two pings in a row of their own under them.
HOLDS_PER_ROW = 3


class PingButton(discord.ui.Button):
    def __init__(self, key, name, label):
        super().__init__(label=label, style=discord.ButtonStyle.primary,
                         custom_id='thornswood:ping:' + key,
                         row=-(-len(HOLDS) // HOLDS_PER_ROW))
        self.role_name = name

    async def callback(self, interaction):
        await toggle_ping(interaction, self.role_name)


class HoldPanel(discord.ui.View):
    """Persistent, like the ticket panel, so the buttons outlive a restart."""
    def __init__(self):
        super().__init__(timeout=None)
        for i, hold in enumerate(HOLDS):
            self.add_item(HoldButton(hold, i // HOLDS_PER_ROW))
        for key, name, label in PINGS:
            self.add_item(PingButton(key, name, label))


def _hold_ids_wanted():
    return (['thornswood:hold:' + h.lower() for h in HOLDS] +
            ['thornswood:ping:' + k for k, _, _ in PINGS])


def _hold_rows_wanted():
    """The panel's buttons by row, as Discord gives a posted message back."""
    ids = ['thornswood:hold:' + h.lower() for h in HOLDS]
    return ([ids[i:i + HOLDS_PER_ROW] for i in range(0, len(ids), HOLDS_PER_ROW)] +
            [['thornswood:ping:' + k for k, _, _ in PINGS]])


def _rows(msg):
    """A posted message's buttons by row, so a panel laid out differently
       is not taken for current because its buttons are the same."""
    try:
        return [[getattr(item, 'custom_id', '') for item in getattr(row, 'children', None) or []]
                for row in getattr(msg, 'components', None) or []]
    except Exception:
        return []


def _hold_ids(msg):
    ids = []
    try:
        for row in getattr(msg, 'components', None) or []:
            for item in getattr(row, 'children', None) or []:
                ids.append(getattr(item, 'custom_id', ''))
    except Exception:
        return []
    return ids


def hold_panel_is_current(msg):
    return (getattr(msg, 'content', None) == HOLD_PANEL and
            _rows(msg) == _hold_rows_wanted())


async def ensure_hold_panel(guild):
    ch = by_name(guild, HOLD_CHANNEL)
    if ch is None:
        log('there is no #%s in "%s", so there is no hold panel. Set '
            'HOLD_CHANNEL in bot.env.json to the right channel.'
            % (HOLD_CHANNEL[0], guild.name))
        return

    missing = [_citizen(h) for h in HOLDS if _role(guild, _citizen(h)) is None]
    if missing:
        log('these hold roles are missing, so those buttons will say so: %s'
            % ', '.join(missing))

    for _, name, _ in PINGS:
        if _role(guild, name) is not None:
            continue
        if not guild.me.guild_permissions.manage_roles:
            log('there is no %s role and the bot cannot make one without '
                'Manage Roles.' % name)
            continue
        try:
            await guild.create_role(name=name, mentionable=False,
                                    reason='Ping role for #choose-your-hold')
            log('made the %s role' % name)
        except Exception:
            log('could not make %s:\n' % name + traceback.format_exc())

    try:
        async for m in ch.history(limit=30):
            # Its own message, by its buttons: the office panel (#2551) is
            # the bot's too, in the same channel, and must not be written over.
            if (m.author.id == client.user.id and m.components and
                    any(i.startswith('thornswood:hold:') for i in _hold_ids(m))):
                if hold_panel_is_current(m):
                    log('hold panel is already current in #%s' % ch.name)
                    return
                await m.edit(content=HOLD_PANEL, view=HoldPanel())
                log('hold panel updated in #%s' % ch.name)
                return
        await ch.send(HOLD_PANEL, view=HoldPanel())
        log('hold panel posted in #%s' % ch.name)
    except Exception:
        log('hold panel failed:\n' + traceback.format_exc())


# ---------------------------------------------------------- hold offices --
#
# #2551. Patrick, 15 Oct: each hold has a Court, a Steward and Guards, and
# they are Discord roles ("<Hold> Court", "Steward of <Hold>", "Guard of
# <Hold>", made by Build-Discord.py and never hoisted). That hold's Jarl gives
# and takes them, two ways, for their own hold only: here, with Add and Remove
# buttons, and in the game on the Office page of K, where the site sets the
# same roles with this bot's token. The role is the one truth either way, so
# nothing here or in the game keeps a list of who holds what.
#
# A Jarl is whoever holds that hold's "Jarl of <Hold>" role. If two accounts
# hold the same one, neither acts as Jarl here until staff take it from all
# but one (Patrick, 15 Oct); the site tells staff which accounts, through the
# staff log, the moment it sees it.
#
# The panel is a second message in #choose-your-hold, under the hold panel,
# found again by its own buttons. Every change is said in the staff channel
# (report_say), with who changed what, and Discord's audit log keeps it with
# the reason. Changes made in the game come to the staff channel the same way,
# through the site's moderation.log (watch_moderation, office_text).
OFFICES = [('court', 'Court'), ('steward', 'Steward'), ('guard', 'Guard')]
# The towns a hold role can name: every hold, Raven Rock included.
OFFICE_TOWNS = list(HOLDS)

OFFICE_PANEL = ('**Hold offices**\n\n'
                'The Jarl of a hold gives and takes its Court, its Steward and '
                'its Guards here, for their own hold only. Press Add or Remove '
                'beside the office, then pick the person. The roles are the '
                'same ones the game reads, and a Jarl can change them there '
                'too, on the Office page of K. In the game the office is held '
                'by one character: the one the Jarl named there, or the one '
                'its holder chooses on the Office page of K. Every change is '
                'said to staff.')


def office_role(office, town):
    """The role's exact name, as Build-Discord.py makes it and the site reads it."""
    if office == 'court':
        return town + ' Court'
    if office == 'steward':
        return 'Steward of ' + town
    if office == 'guard':
        return 'Guard of ' + town
    return ''


def jarl_towns(member):
    """The towns this member is Jarl of, by their own Jarl of <Hold> roles."""
    out = []
    for r in list(getattr(member, 'roles', None) or []):
        name = getattr(r, 'name', '')
        if name.startswith('Jarl of ') and name[len('Jarl of '):] in OFFICE_TOWNS:
            out.append(name[len('Jarl of '):])
    return out


def jarl_held_twice(guild, town):
    """True when more than one account holds this hold's Jarl role."""
    jarl = _role(guild, 'Jarl of ' + town)
    return jarl is not None and len(list(getattr(jarl, 'members', None) or [])) > 1


def office_text(row):
    """
    One office line for the staff channel, from the site's moderation.log or
    from the panel here: a Jarl's change (office), two accounts holding one
    hold's Jarl role (jarlclash), and that ending (jarlclear). Names were
    typed by people, so they are escaped. None for a row that is not one.
    """
    if not isinstance(row, dict):
        return None
    clean = as_typed
    did = row.get('did')
    if did == 'jarlclash':
        people = [p for p in (row.get('people') or []) if isinstance(p, dict)]
        named = ', '.join('%s (account %s)' % (clean(p.get('name'), 40) or 'somebody',
                                               clean(p.get('id'), 24) or '?')
                          for p in people[:10])
        return ('**Two Jarls of one hold:** %d accounts hold the %s role: %s. '
                'Neither acts as Jarl, in the game or on the office panel, '
                'until staff take the role from all but one.'
                % (len(people), clean(row.get('role'), 40) or 'Jarl', named))[:1900]
    if did == 'jarlclear':
        return ('**One Jarl again:** one account or none holds the %s role now, '
                'so whoever holds it acts as Jarl again.'
                % (clean(row.get('role'), 40) or 'Jarl'))[:1900]
    if did != 'office':
        return None

    def person(name, pid):
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            pid = 0
        if pid <= 0:
            return clean(name, 40) or 'somebody'
        return '%s (profile %d)' % (clean(name, 40) or 'somebody', pid)

    hold = clean(row.get('hold'), 20)
    town = hold
    for t in OFFICE_TOWNS:
        if t.lower().replace(' ', '') == hold:
            town = t
    where = {'panel': 'on the office panel', 'dev': 'in the game, on the dev server',
             'main': 'in the game'}.get(row.get('from'), 'in the game')
    role = clean(row.get('role'), 40) or 'an office'
    jarl = person(row.get('byName'), row.get('by'))
    them = person(row.get('whoName'), row.get('who'))
    if row.get('give'):
        did_text = 'gave %s the %s role' % (them, role)
    else:
        did_text = 'took the %s role from %s' % (role, them)
    return ('**Hold office:** %s, Jarl of %s, %s, %s.'
            % (jarl, town, did_text, where))[:1900]


async def office_press(interaction, office, add):
    """Add or Remove beside one office: works out the presser's hold first."""
    guild, who = interaction.guild, interaction.user
    towns = jarl_towns(who) if guild is not None else []
    if not towns:
        await _say(interaction, 'Only the Jarl of a hold gives its offices. A Jarl '
                                'is whoever holds that hold\'s Jarl role.')
        return
    if len(towns) > 1:
        await interaction.response.send_message(
            'You hold more than one Jarl role. Which hold?',
            view=OfficeTownPick(office, add, towns), ephemeral=True)
        return
    await office_for(interaction, office, add, towns[0])


async def office_for(interaction, office, add, town):
    """The picker for one office of one hold: a member to give it, or a holder to take it from."""
    guild = interaction.guild
    if jarl_held_twice(guild, town):
        await _say(interaction, 'Two accounts hold the Jarl of %s role, so neither '
                                'acts as Jarl until staff fix it. Staff have been '
                                'told.' % town)
        return
    name = office_role(office, town)
    role = _role(guild, name)
    if role is None or not _can_give(guild, role):
        log('cannot give %s: the role is missing, or the bot has no Manage '
            'Roles, or its own role is not above it.' % name)
        await _say(interaction, 'The %s role cannot be given out right now. Ask '
                                'staff.' % name)
        return
    if add:
        await interaction.response.send_message(
            'Who gets the %s role?' % name, view=OfficeGive(office, town), ephemeral=True)
        return
    holders = [m for m in list(getattr(role, 'members', None) or [])
               if not getattr(m, 'bot', False)]
    if not holders:
        await _say(interaction, 'Nobody holds the %s role.' % name)
        return
    await interaction.response.send_message(
        'Take the %s role from whom?' % name,
        view=OfficeTake(office, town, holders[:25]), ephemeral=True)


async def office_change(interaction, office, town, member, add):
    """
    Give or take the role, with every rule asked again at the moment of the
    change: the presser still holds that hold's Jarl role, nobody else does,
    and the role is one the bot may give. Said to the Jarl, in bot.log and in
    the staff channel, and the reason goes in Discord's audit log.
    """
    guild, who = interaction.guild, interaction.user
    if guild is None or town not in jarl_towns(who):
        await _say(interaction, 'Only the Jarl of %s gives its offices.' % town)
        return
    if jarl_held_twice(guild, town):
        await _say(interaction, 'Two accounts hold the Jarl of %s role, so neither '
                                'acts as Jarl until staff fix it. Staff have been '
                                'told.' % town)
        return
    name = office_role(office, town)
    role = _role(guild, name)
    if role is None or not _can_give(guild, role):
        await _say(interaction, 'The %s role cannot be given out right now. Ask '
                                'staff.' % name)
        return
    if member is None or not hasattr(member, 'roles'):
        await _say(interaction, 'That person is not in this Discord.')
        return
    if getattr(member, 'bot', False):
        await _say(interaction, 'A bot holds no office.')
        return
    shown = getattr(member, 'display_name', None) or str(member)
    has = role in member.roles
    if add and has:
        await _say(interaction, '%s already holds the %s role.' % (shown, name))
        return
    if not add and not has:
        await _say(interaction, '%s does not hold the %s role.' % (shown, name))
        return
    by = getattr(who, 'display_name', None) or str(who)
    reason = '%s by %s, Jarl of %s, on the office panel' % ('Given' if add else 'Taken', by, town)
    try:
        if add:
            await member.add_roles(role, reason=reason)
        else:
            await member.remove_roles(role, reason=reason)
    except Exception:
        log('office change failed:\n' + traceback.format_exc())
        await _say(interaction, 'That did not go through. Try again, or ask staff.')
        return
    log('office: %s (%s), Jarl of %s, %s %s (%s) the %s role'
        % (by, who.id, town, 'gave' if add else 'took from', shown, member.id, name))
    await _say(interaction, ('%s holds the %s role now. In the game they choose which '
                             'character holds it, on the Office page of K.' if add
                             else '%s no longer holds the %s role.') % (shown, name))
    await report_say(office_text({
        'did': 'office', 'from': 'panel', 'give': bool(add), 'office': office,
        'hold': town.lower().replace(' ', ''), 'role': name,
        'byName': by, 'whoName': shown}))


class OfficeButton(discord.ui.Button):
    def __init__(self, office, label, add, row):
        super().__init__(label=('Add ' if add else 'Remove ') + label,
                         style=(discord.ButtonStyle.primary if add
                                else discord.ButtonStyle.secondary),
                         custom_id='thornswood:office:%s:%s' % ('add' if add else 'remove', office),
                         row=row)
        self.office = office
        self.add = add

    async def callback(self, interaction):
        await office_press(interaction, self.office, self.add)


class OfficePanel(discord.ui.View):
    """Persistent, like the hold panel: Add and Remove for each of the three offices."""
    def __init__(self):
        super().__init__(timeout=None)
        for i, (office, label) in enumerate(OFFICES):
            self.add_item(OfficeButton(office, label, True, i))
            self.add_item(OfficeButton(office, label, False, i))


class OfficeTownSelect(discord.ui.Select):
    def __init__(self, office, add, towns):
        super().__init__(placeholder='The hold',
                         options=[discord.SelectOption(label=t, value=t) for t in towns[:25]])
        self.office = office
        self.add = add

    async def callback(self, interaction):
        await office_for(interaction, self.office, self.add, self.values[0])


class OfficeTownPick(discord.ui.View):
    def __init__(self, office, add, towns):
        super().__init__(timeout=180)
        self.add_item(OfficeTownSelect(office, add, towns))


class OfficeGiveSelect(discord.ui.UserSelect):
    def __init__(self, office, town):
        super().__init__(placeholder='The person', min_values=1, max_values=1)
        self.office = office
        self.town = town

    async def callback(self, interaction):
        picked = self.values[0] if self.values else None
        # A pick of somebody not in this Discord comes back as a User, which
        # has no roles to give.
        member = picked if hasattr(picked, 'roles') else (
            interaction.guild.get_member(getattr(picked, 'id', 0)) if interaction.guild else None)
        await office_change(interaction, self.office, self.town, member, True)


class OfficeGive(discord.ui.View):
    def __init__(self, office, town):
        super().__init__(timeout=180)
        self.add_item(OfficeGiveSelect(office, town))


class OfficeTakeSelect(discord.ui.Select):
    def __init__(self, office, town, holders):
        super().__init__(placeholder='The person', options=[
            discord.SelectOption(label=(getattr(m, 'display_name', None) or str(m))[:100],
                                 value=str(m.id)) for m in holders])
        self.office = office
        self.town = town

    async def callback(self, interaction):
        try:
            mid = int(self.values[0])
        except (TypeError, ValueError, IndexError):
            mid = 0
        member = interaction.guild.get_member(mid) if interaction.guild else None
        await office_change(interaction, self.office, self.town, member, False)


class OfficeTake(discord.ui.View):
    def __init__(self, office, town, holders):
        super().__init__(timeout=180)
        self.add_item(OfficeTakeSelect(office, town, holders))


# The in-world roles the game reads, as Build-Discord.py makes them: name,
# colour, shown as a group of its own. The office roles are never hoisted
# (Patrick, 15 Oct); the Jarl roles are.
JARL_COLOUR = 0xE0C56A
OFFICE_COLOUR = 0xA8977A


def office_roles_wanted():
    out = [('Jarl of ' + t, JARL_COLOUR, True) for t in OFFICE_TOWNS]
    for t in OFFICE_TOWNS:
        for o, _ in OFFICES:
            out.append((office_role(o, t), OFFICE_COLOUR, False))
    return out


async def ensure_office_roles(guild):
    """
    Make any Jarl or office role the game reads that is missing, the way the
    hold panel makes its two ping roles, so the offices exist as soon as the
    bot that gives them is running, without a run of Build-Discord.py (which
    asks for the bot's token at a prompt). Raven Rock's included (#2551,
    Patrick, 16 Oct). Nothing that is there is changed. A new Jarl role goes
    under the lowest Jarl role there is, and a new office role under the
    lowest Citizen role, where Build-Discord.py keeps them; a build later puts
    every role in its exact place. Says in bot.log what it made.
    """
    if not guild.me.guild_permissions.manage_roles:
        log('the office roles cannot be made: the bot has no Manage Roles.')
        return []
    made = []
    for name, colour, hoist in office_roles_wanted():
        if _role(guild, name) is not None:
            continue
        under = [r for r in guild.roles
                 if r.name.startswith('Jarl of ' if hoist else 'Citizen of ')]
        try:
            role = await guild.create_role(name=name, colour=discord.Colour(colour), hoist=hoist,
                                           mentionable=True, reason='Thornswood hold offices (#2551)')
            made.append(name)
            if under:
                low = min(under, key=lambda r: r.position)
                try:
                    await role.edit(position=max(1, low.position))
                except Exception:
                    log('made %s, and could not move it under %s:\n' % (name, low.name)
                        + traceback.format_exc())
        except Exception:
            log('could not make the %s role:\n' % name + traceback.format_exc())
    if made:
        log('made the office roles that were missing: %s' % ', '.join(made))
    return made


def _office_ids_wanted():
    out = []
    for office, _ in OFFICES:
        out += ['thornswood:office:add:' + office, 'thornswood:office:remove:' + office]
    return out


def office_panel_is_current(msg):
    return (getattr(msg, 'content', None) == OFFICE_PANEL and
            _hold_ids(msg) == _office_ids_wanted())


async def ensure_office_panel(guild):
    """The office panel in #choose-your-hold, under the hold panel, found again by its own buttons."""
    ch = by_name(guild, HOLD_CHANNEL)
    if ch is None:
        return
    missing = [office_role(o, t) for t in HOLDS for o, _ in OFFICES
               if _role(guild, office_role(o, t)) is None]
    if missing:
        log('these office roles are missing, so those offices cannot be given '
            'until Build-Discord.py makes them: %s' % ', '.join(missing))
    try:
        async for m in ch.history(limit=30):
            if (m.author.id == client.user.id and m.components and
                    any(i.startswith('thornswood:office:') for i in _hold_ids(m))):
                if office_panel_is_current(m):
                    log('office panel is already current in #%s' % ch.name)
                    return
                await m.edit(content=OFFICE_PANEL, view=OfficePanel())
                log('office panel updated in #%s' % ch.name)
                return
        await ch.send(OFFICE_PANEL, view=OfficePanel())
        log('office panel posted in #%s' % ch.name)
    except Exception:
        log('office panel failed:\n' + traceback.format_exc())


# ------------------------------------------------------ faction members --
#
# #3317. Patrick, 22 Oct, page card q-3317-faction-member-give, A: a
# faction's Leader gives and takes its member role from a bot panel. The
# member role is the faction's short name ("Thalmor", "Companions"), made by
# Build-Discord.py with its "<short name> Leader" role, and the Leader is
# whoever holds that role. Like a Jarl's offices: their own faction only, and
# when two accounts hold one Leader role neither acts until staff take it
# from all but one.
#
# Patrick, 22 Oct, later: "seats should be in a different channel like how
# the holds have the add member add court add a steward so one for each
# faction in it's category", and on page card q-3317-faction-category, C:
# "One Officer role, not Court and Steward". So each faction has its own
# category, and in it its own seats channel with this panel: Add and Remove
# for its members and its Officers ("<short> Officer"). The faction is the
# channel's. The shared #seats it was in until then is retired; its old panel
# says where the panels went until -Prune deletes it.
#
# A change goes in bot.log and in Discord's audit log with its reason; it is
# not said to staff, because staff have nothing to do about it (Patrick,
# 22 Oct: #staff-updates only when staff must act).
FACTION_OFFICES = [('member', 'member'), ('officer', 'Officer')]
FACTION_LABELS = {
    'member': ('Add member', 'Remove member'),
    'officer': ('Add Officer', 'Remove Officer'),
}
# The one shared panel of before, in #seats.
OLD_FACTION_PANEL_CHANNEL = ['seats']


def faction_slug(faction):
    """A faction's channel name: its short name, lower case, hyphens, as
       Build-Discord.py names its channels."""
    return FACTION_SHORT.get(faction, faction).lower().replace(' ', '-')


def faction_seats(faction):
    """The channel a faction's panel is in: "#companions-seats"."""
    return faction_slug(faction) + '-seats'


def faction_role(office, faction):
    """A faction's role for an office, as Build-Discord.py makes it."""
    short = FACTION_SHORT.get(faction, faction)
    if office == 'officer':
        return short + ' Officer'
    return short


def faction_member_role(faction):
    """The member role of a named faction: "Thalmor"."""
    return faction_role('member', faction)


def faction_of_channel(ch):
    """The faction whose seats channel this is, or None."""
    name = (getattr(ch, 'name', '') or '').lower()
    for f in faction_names():
        if faction_seats(f) == name:
            return f
    return None


def faction_panel_text(faction):
    return ('**%s: seats**\n\n'
            'The Leader of %s gives and takes its roles here: its members and '
            'its Officers. Press a button, then pick the person. Only the '
            'Leader can use them. An Officer is a member first, and taking '
            'somebody\'s membership takes their Officer role with it.'
            % (faction, faction))


def led_factions(member):
    """The named factions this member leads, by their own Leader roles."""
    held = set(getattr(r, 'name', '') for r in list(getattr(member, 'roles', None) or []))
    return [f for f in faction_names() if faction_leader_role(f) in held]


def leader_held_twice(guild, faction):
    """True when more than one account holds this faction's Leader role."""
    lead = _role(guild, faction_leader_role(faction))
    return lead is not None and len(list(getattr(lead, 'members', None) or [])) > 1


LEADER_TWICE = ('Two accounts hold the %s role, so neither acts as its Leader '
                'until staff take it from all but one.')


async def faction_press(interaction, add, office='member'):
    """A button on a faction's panel: that faction's, by the channel it is
       in, for its Leader only. Off a seats channel (the old shared panel),
       the presser's own faction, asked which when they lead two."""
    guild, who = interaction.guild, interaction.user
    led = led_factions(who) if guild is not None else []
    here = faction_of_channel(getattr(interaction, 'channel', None))
    if here is not None:
        if here not in led:
            await _say(interaction, 'Only the Leader of %s uses these buttons.' % here)
            return
        await faction_for(interaction, here, add, office)
        return
    if not led:
        await _say(interaction, 'Only the Leader of a faction gives its member '
                                'role. A Leader is whoever holds that faction\'s '
                                'Leader role.')
        return
    if len(led) > 1:
        await interaction.response.send_message(
            'You lead more than one faction. Which one?',
            view=FactionPick(add, led, office), ephemeral=True)
        return
    await faction_for(interaction, led[0], add, office)


def _faction_ask(faction, office):
    if office == 'officer':
        return 'Who becomes an Officer of %s?' % faction
    return 'Who joins %s?' % faction


async def faction_for(interaction, faction, add, office='member'):
    """The picker for one faction and office: a person to give the role, or a
       holder to take it from."""
    guild = interaction.guild
    if leader_held_twice(guild, faction):
        await _say(interaction, LEADER_TWICE % faction_leader_role(faction))
        return
    name = faction_role(office, faction)
    role = _role(guild, name)
    if role is None or not _can_give(guild, role):
        log('cannot give %s: the role is missing, or the bot has no Manage '
            'Roles, or its own role is not above it.' % name)
        await _say(interaction, 'The %s role cannot be given out right now. Ask '
                                'staff.' % name)
        return
    if add:
        await interaction.response.send_message(
            _faction_ask(faction, office), view=FactionGive(faction, office), ephemeral=True)
        return
    holders = [m for m in list(getattr(role, 'members', None) or [])
               if not getattr(m, 'bot', False)]
    if not holders:
        await _say(interaction, 'Nobody holds the %s role.' % name)
        return
    await interaction.response.send_message(
        'Take the %s role from whom?' % name,
        view=FactionTake(faction, holders[:25], office), ephemeral=True)


async def faction_change(interaction, faction, member, add, office='member'):
    """
    Give or take one of the faction's roles, with every rule asked again at
    the moment of the change: the presser still holds the faction's Leader
    role, nobody else does, and the role is one the bot may give. The
    Officer role goes only to a member, and taking the member role takes it
    with it.
    """
    guild, who = interaction.guild, interaction.user
    if guild is None or faction not in led_factions(who):
        await _say(interaction, 'Only the Leader of %s gives its %s.' % (
            faction, 'member role' if office == 'member' else 'roles'))
        return
    if leader_held_twice(guild, faction):
        await _say(interaction, LEADER_TWICE % faction_leader_role(faction))
        return
    name = faction_role(office, faction)
    role = _role(guild, name)
    if role is None or not _can_give(guild, role):
        await _say(interaction, 'The %s role cannot be given out right now. Ask '
                                'staff.' % name)
        return
    if member is None or not hasattr(member, 'roles'):
        await _say(interaction, 'That person is not in this Discord.')
        return
    if getattr(member, 'bot', False):
        await _say(interaction, 'A bot joins no faction.')
        return
    shown = getattr(member, 'display_name', None) or str(member)
    has = role in member.roles
    if add and has:
        await _say(interaction, '%s already holds the %s role.' % (shown, name))
        return
    if not add and not has:
        await _say(interaction, '%s does not hold the %s role.' % (shown, name))
        return
    if add and office != 'member':
        joined = _role(guild, faction_member_role(faction))
        if joined is None or joined not in member.roles:
            await _say(interaction, '%s is not a member of %s. Add them as a '
                                    'member first.' % (shown, faction))
            return
    by = getattr(who, 'display_name', None) or str(who)
    reason = '%s by %s, Leader of %s, on the faction panel' % (
        'Given' if add else 'Taken', by, faction)
    # Leaving the faction leaves its offices too.
    also = []
    if not add and office == 'member':
        also = [r for r in (_role(guild, faction_role(o, faction))
                            for o, _ in FACTION_OFFICES if o != 'member')
                if r is not None and r in member.roles]
    try:
        if add:
            await member.add_roles(role, reason=reason)
        else:
            for r in [role] + also:
                await member.remove_roles(r, reason=reason)
    except Exception:
        log('faction change failed:\n' + traceback.format_exc())
        await _say(interaction, 'That did not go through. Try again, or ask staff.')
        return
    log('faction: %s (%s), Leader of %s, %s %s (%s) the %s role'
        % (by, who.id, faction, 'gave' if add else 'took from', shown, member.id,
           ', '.join([name] + [r.name for r in also])))
    if add:
        said = '%s holds the %s role now.' % (shown, name)
    elif also:
        said = '%s no longer holds the %s role, nor %s.' % (
            shown, name, ' or '.join(r.name for r in also))
    else:
        said = '%s no longer holds the %s role.' % (shown, name)
    await _say(interaction, said)


class FactionButton(discord.ui.Button):
    def __init__(self, add, office='member', row=None):
        add_label, remove_label = FACTION_LABELS[office]
        # The member buttons keep the custom_id the one shared panel had.
        tail = '' if office == 'member' else ':' + office
        super().__init__(label=add_label if add else remove_label,
                         style=(discord.ButtonStyle.primary if add
                                else discord.ButtonStyle.secondary),
                         custom_id='thornswood:faction:%s%s' % ('add' if add else 'remove', tail),
                         row=row)
        self.add = add
        self.office = office

    async def callback(self, interaction):
        await faction_press(interaction, self.add, self.office)


class FactionPanel(discord.ui.View):
    """Persistent, like the office panel: Add and Remove for each of the
       faction's roles, a row each. The same buttons in every faction's seats
       channel; the channel says which faction."""
    def __init__(self):
        super().__init__(timeout=None)
        for row, (office, _label) in enumerate(FACTION_OFFICES):
            self.add_item(FactionButton(True, office, row))
            self.add_item(FactionButton(False, office, row))


class FactionPickSelect(discord.ui.Select):
    def __init__(self, add, factions, office='member'):
        super().__init__(placeholder='The faction',
                         options=[discord.SelectOption(label=f[:100], value=f) for f in factions[:25]])
        self.add = add
        self.office = office

    async def callback(self, interaction):
        await faction_for(interaction, self.values[0], self.add, self.office)


class FactionPick(discord.ui.View):
    def __init__(self, add, factions, office='member'):
        super().__init__(timeout=180)
        self.add_item(FactionPickSelect(add, factions, office))


class FactionGiveSelect(discord.ui.UserSelect):
    def __init__(self, faction, office='member'):
        super().__init__(placeholder='The person', min_values=1, max_values=1)
        self.faction = faction
        self.office = office

    async def callback(self, interaction):
        picked = self.values[0] if self.values else None
        member = picked if hasattr(picked, 'roles') else (
            interaction.guild.get_member(getattr(picked, 'id', 0)) if interaction.guild else None)
        await faction_change(interaction, self.faction, member, True, self.office)


class FactionGive(discord.ui.View):
    def __init__(self, faction, office='member'):
        super().__init__(timeout=180)
        self.add_item(FactionGiveSelect(faction, office))


class FactionTakeSelect(discord.ui.Select):
    def __init__(self, faction, holders, office='member'):
        super().__init__(placeholder='The person', options=[
            discord.SelectOption(label=(getattr(m, 'display_name', None) or str(m))[:100],
                                 value=str(m.id)) for m in holders])
        self.faction = faction
        self.office = office

    async def callback(self, interaction):
        try:
            mid = int(self.values[0])
        except (TypeError, ValueError, IndexError):
            mid = 0
        member = interaction.guild.get_member(mid) if interaction.guild else None
        await faction_change(interaction, self.faction, member, False, self.office)


class FactionTake(discord.ui.View):
    def __init__(self, faction, holders, office='member'):
        super().__init__(timeout=180)
        self.add_item(FactionTakeSelect(faction, holders, office))


def faction_panel_ids():
    return [b.custom_id for b in FactionPanel().children]


def faction_panel_is_current(msg, faction):
    return (getattr(msg, 'content', None) == faction_panel_text(faction) and
            _hold_ids(msg) == faction_panel_ids())


FACTION_MOVED_HEAD = '**Faction panels have moved**'


async def ensure_faction_panel(guild):
    """Each faction's panel in its own seats channel, found again by its own
       buttons; the old shared one in #seats told where they went."""
    missing = [faction_role(o, f) for f in faction_names() for o, _ in FACTION_OFFICES
               if _role(guild, faction_role(o, f)) is None]
    if missing:
        log('these faction roles are missing, so they cannot be given until '
            'Build-Discord.py makes them: %s' % ', '.join(missing))
    here = []
    nowhere = []
    for f in faction_names():
        ch = by_name(guild, [faction_seats(f)])
        if ch is None:
            nowhere.append(faction_seats(f))
            continue
        here.append(ch)
        await _faction_panel_in(ch, f)
    if nowhere:
        log('no #%s yet, so those factions\' panels wait for Build-Discord.py '
            'to make them' % ', #'.join(nowhere))
    old = by_name(guild, OLD_FACTION_PANEL_CHANNEL)
    if old is not None and here:
        await _old_faction_panel(old, here)


async def _faction_panel_in(ch, faction):
    text = faction_panel_text(faction)
    try:
        async for m in ch.history(limit=30):
            if (m.author.id == client.user.id and m.components and
                    any(i.startswith('thornswood:faction:') for i in _hold_ids(m))):
                if faction_panel_is_current(m, faction):
                    log('faction panel is already current in #%s' % ch.name)
                    return
                await m.edit(content=text, view=FactionPanel())
                log('faction panel updated in #%s' % ch.name)
                return
        await ch.send(text, view=FactionPanel())
        log('faction panel posted in #%s' % ch.name)
    except Exception:
        log('faction panel failed in #%s:\n' % ch.name + traceback.format_exc())


async def _old_faction_panel(old, here):
    text = (FACTION_MOVED_HEAD + '\n\nEach faction has its own seats channel '
            'now, in its own category, with its Leader\'s buttons for its '
            'members and its Officers.')
    try:
        async for m in old.history(limit=30):
            if m.author.id != client.user.id:
                continue
            if m.content == text and not m.components:
                return
            if (m.components and any(i.startswith('thornswood:faction:') for i in _hold_ids(m))) \
                    or (m.content or '').startswith(FACTION_MOVED_HEAD):
                await m.edit(content=text, view=None)
                log('the old faction panel in #%s now says where the panels went' % old.name)
                return
    except Exception:
        log('the old faction panel in #%s could not be changed:\n' % old.name
            + traceback.format_exc())


# ------------------------------------------------------- testing channels --
#
# Patrick's card of 11 October. The Live smoke checklist that lived in
# #test-tasks (dated sessions, Pass/Fail/Skip/Fail-known rows, /live-smoke)
# is gone, and the testing channels are three things instead:
#
#   #test-tasks     a Forum. One thread per test task, tagged Main: the
#                   bot posts one, tagged Main, for each issue closed as fixed
#                   (see known issues below), and staff can post one by hand
#                   (/test-task, or python bot.py --post-task), tagged Main.
#   #test-findings  what #test-results was, renamed. Nothing else about it moves.
#   #known-issues   a Forum, read only: one bot post per open GitHub issue
#                   labelled Dev Findings or Main Findings, title only, no
#                   number and no link. The post goes when the issue is closed,
#                   which is when its fix is on main (Patrick, 11 Oct: one
#                   entry per issue, not one list).
#   #dev-test-tasks a Forum in Staff, staff only (Patrick, 12 Oct): the test
#                   tasks someone on dev has to measure, from comments that
#                   say "Server: Dev" (see known issues below), and staff
#                   can post one by hand (/test-task with the tag Dev, or
#                   --post-task --tag Dev). Most go to #test-tasks, because
#                   testers play on main in the alpha.
#
# THE ONE-TIME SETUP. Getting the server from the old shape to that one is the
# only channel change the bot makes, and Patrick's explicit exception to the
# never-touch-channels rule, for these three changes only. It runs only when
# asked, from the command line, never on a normal start:
#
#   python bot.py --setup-channels            says what it would do, changes nothing
#   python bot.py --setup-channels --apply    does it, once
#
# A finished apply is written to channel-setup.json in the data folder, and a
# second run reads it and does nothing at all. Each step also looks at the
# server before it acts, so an apply that stopped half way picks up where it
# stopped. Permission overwrites are copied, never invented.
#
# Discord cannot turn a text channel into a forum (a channel's type can only go
# between text and announcement). The edit is asked for anyway, in case that
# changes, and when Discord refuses it a new forum called test-tasks is made in
# the same category, at the same position, with the old channel's overwrites,
# and the old one is renamed test-tasks-archive with sending switched off for
# everyone but the bot. Nothing is deleted.
#
# #dev-test-tasks is the third one-time step (Patrick, 12 Oct), on a server
# that already had the first two: the forum is made in the category whose id
# is DEV_TASKS_CATEGORY, with that category's overwrites copied, so the same
# staff see it, and the bot's own forum rights from #test-tasks. Its id is
# written to channel-setup.json as dev_tasks_id, and from then on the bot
# finds it by that id and never by its name, so a rename keeps it and no
# second one is made. A forum of that name already in the category (made by
# hand or by Build-Discord.py) is taken as it is and its id recorded.
TASKS_NAME = os.environ.get('TEST_TASKS_CHANNEL', 'test-tasks').strip().lower()
TASKS_ARCHIVE = TASKS_NAME + '-archive'
FINDINGS_OLD = 'test-results'
FINDINGS_NAME = os.environ.get('TEST_FINDINGS_CHANNEL', 'test-findings').strip().lower()
KNOWN_NAME = os.environ.get('KNOWN_ISSUES_CHANNEL', 'known-issues').strip().lower()
DEV_TASKS_NAME = os.environ.get('DEV_TASKS_CHANNEL', 'dev-test-tasks').strip().lower()
# The Staff category (Patrick, 12 Oct: "a new forum under 1549254990110134374
# the Staff category").
DEV_TASKS_CATEGORY = _int_env('DEV_TASKS_CATEGORY', 1549254990110134374)
# The one tag a post in #dev-test-tasks carries.
DEV_TAG = 'Dev'
DEV_TOPIC = ('Test tasks someone on dev has to measure, from the board. Kept '
             'by the bot: a post goes when its issue closes as fixed or its '
             'test task no longer says Server: Dev.')
# What the bot is allowed in a forum it keeps: see it, make a post, write in
# a post, delete a post (manage threads), and read back what is there.
FORUM_BOT_NEEDS = ('view_channel', 'send_messages', 'send_messages_in_threads',
                   'manage_threads', 'read_message_history')
TASK_TAGS = ('Dev', 'Main')
# The tags a test task posted by hand may carry, and the forum each goes to
# (Patrick, 12 Oct, on #2276, reversing the Main only hand posts of #2413):
# Main, the default, to #test-tasks for testers on main; Dev to the staff
# #dev-test-tasks, for something someone on dev has to measure. #test-tasks
# itself is Main only: it keeps its Dev tag for older threads, nothing new
# gets it.
TASK_POST_TAG = 'Main'
HAND_TAGS = ('Main', 'Dev')
SETUP_STATE = os.path.join(DATA_DIR, 'channel-setup.json')
KNOWN_STATE = os.path.join(DATA_DIR, 'known-issues.json')
SETUP_REASON = 'Thornswood channel setup (one time, Patrick 11 Oct)'
# The send permissions switched off on the archived channel, and only those.
ARCHIVE_LOCK = ('send_messages', 'send_messages_in_threads',
                'create_public_threads', 'create_private_threads')
# Who may post a test task with /test-task. The same people who could run the
# Live smoke sessions, by id (preferred) or by name. A bot.env.json that still
# carries LIVE_SMOKE_ADMIN_ROLES (with the role ids in it) keeps working.
TASK_ROLE_NAMES = [r.strip() for r in
                   (os.environ.get('TEST_TASK_ROLES', '').strip()
                    or os.environ.get('LIVE_SMOKE_ADMIN_ROLES', '').strip()
                    or 'Owner,Dev,Lead Gamemaster,Lead GM').split(',')
                   if r.strip()]
# Forum titles are capped at 100 by Discord and a first message at 2000.
TASK_TITLE_ROOM = 100
TASK_BODY_ROOM = 2000


def _channel_named(guild, name, kinds=None):
    """Any channel in the server by name, text, forum or other, optionally of
       the given kinds ('text', 'forum'). guild.channels, not text_channels,
       because a forum is not in text_channels."""
    for ch in list(getattr(guild, 'channels', None) or []):
        if str(getattr(ch, 'name', '') or '').lower() != name:
            continue
        if kinds and _kind(ch) not in kinds:
            continue
        return ch
    return None


def _kind(ch):
    t = getattr(ch, 'type', None)
    return getattr(t, 'name', str(t or ''))


def _copy_overwrites(ch):
    """The channel's overwrites as a fresh dict, each one copied, so changing
       the copy never touches the original."""
    out = {}
    for target, ow in dict(getattr(ch, 'overwrites', None) or {}).items():
        allow, deny = ow.pair()
        out[target] = discord.PermissionOverwrite.from_pair(allow, deny)
    return out


def known_overwrites(guild, like):
    """
    #known-issues' overwrites: #test-findings' copied, so the same people see
    it, then made read only (Patrick, 11 Oct). Sending and threads are off for
    @everyone and every copied role or member; the bot alone may send.
    """
    out = _copy_overwrites(like) if like is not None else {}
    me = getattr(guild, 'me', None)
    everyone = getattr(guild, 'default_role', None)
    if everyone is not None and everyone not in out:
        out[everyone] = discord.PermissionOverwrite()
    for t, ow in out.items():
        if t == me:
            continue
        ow.update(**dict((n, False) for n in ARCHIVE_LOCK))
    if me is not None:
        mine = out.get(me) or discord.PermissionOverwrite()
        # In a forum, send_messages is making a post and manage_threads is
        # deleting one: the bot does both as issues come and go.
        mine.update(view_channel=True, send_messages=True,
                    send_messages_in_threads=True, manage_threads=True,
                    read_message_history=True)
        out[me] = mine
    return out


def _state_read(path):
    try:
        with open(path, encoding='utf-8') as f:
            got = json.load(f)
        return got if isinstance(got, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception:
        return None


def _state_write(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1, sort_keys=True)
    os.replace(tmp, path)


def setup_done(guild, path=None):
    """When the setup finished on this server, or None."""
    got = _state_read(path or SETUP_STATE) or {}
    rec = (got.get('guilds') or {}).get(str(getattr(guild, 'id', '')))
    return rec.get('done') if isinstance(rec, dict) else None


def _tags_missing(forum):
    have = set(str(getattr(t, 'name', '')).lower()
               for t in (getattr(forum, 'available_tags', None) or []))
    return [t for t in TASK_TAGS if t.lower() not in have]


async def channel_setup(guild, apply=False, path=None):
    """
    The one-time setup on one server. Returns what it did (or with apply
    False, what it would do), one line per change.

    Never runs twice: a server channel-setup.json says is done, with its
    #known-issues forum and its #dev-test-tasks forum (still there, by id),
    gets one line saying so, and nothing is asked of Discord. A server set up
    before a later step existed gets that step alone, once.
    """
    path = path or SETUP_STATE
    state = _state_read(path)
    if state is None:
        return ['%s is there but cannot be read, so nothing was changed. Look '
                'at it by hand.' % path]
    done = setup_done(guild, path)
    if (done and known_forum_done(guild, path)
            and dev_tasks_forum(guild, path) is not None):
        return ['already done on %s, nothing changed' % done]
    if not done:
        said, stop = await _first_setup(guild, apply, path)
        if stop:
            return said
    elif not known_forum_done(guild, path):
        # Set up before #known-issues was a forum: that one step, once.
        said = await known_forum_setup(guild, apply, path)
    else:
        said = []
    said += await dev_tasks_setup(guild, apply, path)
    if not said:
        said.append('nothing to change')
    return said


async def _first_setup(guild, apply, path):
    """The first one-time setup: #test-tasks a forum, #test-results renamed
       #test-findings, the #known-issues forum. Returns (lines, stop), stop
       True when nothing could be done and no later step should run."""
    said = []
    verb = '' if apply else 'would '

    # 1. #test-tasks becomes a forum.
    tasks = _channel_named(guild, TASKS_NAME, ('forum',))
    old = _channel_named(guild, TASKS_NAME, ('text',))
    if tasks is None and old is None:
        return ['there is no #%s in "%s", so nothing was changed. Make it '
                '(Build-Discord.py) and run this again.'
                % (TASKS_NAME, getattr(guild, 'name', '?'))], True
    if tasks is None:
        said.append('%stry to convert #%s to a forum' % (verb, TASKS_NAME))
        if apply:
            try:
                await old.edit(type=discord.ChannelType.forum, reason=SETUP_REASON)
                tasks = _channel_named(guild, TASKS_NAME, ('forum',))
                if tasks is not None:
                    old = None
            except (discord.HTTPException, TypeError, ValueError,
                    AttributeError) as e:
                said.append('Discord refused the conversion (%s), so the '
                            'fallback' % (getattr(e, 'text', '') or type(e).__name__))
        if tasks is None:
            said.append('%smake a new forum #%s in %s with the old channel\'s '
                        '%d permission overwrite(s) and the tags %s'
                        % (verb, TASKS_NAME,
                           getattr(old.category, 'name', None) or 'no category',
                           len(getattr(old, 'overwrites', {}) or {}),
                           ', '.join(TASK_TAGS)))
            if apply:
                tasks = await guild.create_forum(
                    TASKS_NAME, category=old.category,
                    position=getattr(old, 'position', None) or 0,
                    overwrites=_copy_overwrites(old),
                    topic='One thread per test task, tagged Main.',
                    available_tags=[discord.ForumTag(name=t) for t in TASK_TAGS],
                    reason=SETUP_REASON)
    if old is not None:
        # The text channel still called test-tasks, beside the new forum.
        said.append('%srename the old text #%s to #%s and switch off sending '
                    'in it for everyone but the bot (nothing deleted)'
                    % (verb, TASKS_NAME, TASKS_ARCHIVE))
        if apply:
            await old.edit(name=TASKS_ARCHIVE, reason=SETUP_REASON)
            me = getattr(guild, 'me', None)
            targets = [t for t in (getattr(old, 'overwrites', {}) or {})
                       if t != me]
            everyone = getattr(guild, 'default_role', None)
            if everyone is not None and everyone not in targets:
                targets.append(everyone)
            for t in targets:
                ow = old.overwrites_for(t)
                ow.update(**dict((n, False) for n in ARCHIVE_LOCK))
                await old.set_permissions(t, overwrite=ow, reason=SETUP_REASON)
    if tasks is not None:
        missing = _tags_missing(tasks)
        if missing:
            said.append('%sadd the forum tag(s) %s to #%s'
                        % (verb, ', '.join(missing), TASKS_NAME))
            if apply:
                tags = list(getattr(tasks, 'available_tags', None) or [])
                tags += [discord.ForumTag(name=t) for t in missing]
                await tasks.edit(available_tags=tags, reason=SETUP_REASON)

    # 2. #test-results becomes #test-findings. A rename keeps everything else.
    findings = _channel_named(guild, FINDINGS_NAME)
    if findings is None:
        was = _channel_named(guild, FINDINGS_OLD)
        if was is None:
            said.append('there is no #%s or #%s, so that rename was skipped'
                        % (FINDINGS_OLD, FINDINGS_NAME))
        else:
            said.append('%srename #%s to #%s' % (verb, FINDINGS_OLD, FINDINGS_NAME))
            if apply:
                await was.edit(name=FINDINGS_NAME, reason=SETUP_REASON)
            findings = was

    # 3. #known-issues, a forum beside #test-findings, with its overwrites.
    said += await _known_forum_make(guild, findings, apply, verb)

    if apply:
        state = _state_read(path) or {}
        now = _utc_stamp()
        rec = state.setdefault('guilds', {}).setdefault(str(guild.id), {})
        rec.update(done=now, known_forum=now, name=getattr(guild, 'name', ''))
        _state_write(path, state)
        said.append('recorded in %s, so this never runs again' % path)
    return said, False


def _utc_stamp():
    return (datetime.datetime.now(datetime.timezone.utc)
            .strftime('%Y-%m-%dT%H:%M:%SZ'))


def known_forum_done(guild, path=None):
    """When #known-issues was made a forum on this server, or None."""
    got = _state_read(path or SETUP_STATE) or {}
    rec = (got.get('guilds') or {}).get(str(getattr(guild, 'id', '')))
    return rec.get('known_forum') if isinstance(rec, dict) else None


async def _known_forum_make(guild, like, apply, verb):
    """The #known-issues forum, read only, with the Dev and Main tags, when
       there is none. One line per change."""
    said = []
    if _channel_named(guild, KNOWN_NAME, ('forum',)) is not None:
        return said
    said.append('%smake the forum #%s in %s with %s and the tags %s' % (
        verb, KNOWN_NAME,
        getattr(getattr(like, 'category', None), 'name', 'no category'),
        ('the %d permission overwrite(s) of #%s'
         % (len(getattr(like, 'overwrites', {}) or {}), FINDINGS_NAME))
        if like is not None else 'no overwrites of its own',
        ', '.join(TASK_TAGS)))
    said.append('%smake #%s read only: posting and replies off for @everyone '
                'and every copied overwrite; the bot alone posts and deletes '
                'there' % (verb, KNOWN_NAME))
    if apply:
        await guild.create_forum(
            KNOWN_NAME, category=getattr(like, 'category', None),
            position=(getattr(like, 'position', None) or 0) + 1,
            overwrites=known_overwrites(guild, like),
            topic='One post per known issue being worked on. Kept by the bot: '
                  'a post goes when its fix is on main and becomes a test task.',
            available_tags=[discord.ForumTag(name=t) for t in TASK_TAGS],
            reason=SETUP_REASON)
    return said


async def known_forum_setup(guild, apply=False, path=None):
    """
    The second one-time step (Patrick, 11 Oct): #known-issues is a forum with
    one post per known issue, not one channel of messages. On a server whose
    first setup made a text #known-issues, that channel goes: deleted when
    every message in it is the bot's own (all it ever held was the bot's
    list), otherwise renamed known-issues-archive and locked like the tasks
    archive. Then the forum is made. Recorded as known_forum, so it runs once.
    """
    path = path or SETUP_STATE
    verb = '' if apply else 'would '
    said = []
    old = _channel_named(guild, KNOWN_NAME, ('text',))
    if old is not None:
        me = getattr(guild, 'me', None)
        mine_only, n = True, 0
        async for msg in old.history(limit=1000):
            n += 1
            if getattr(msg.author, 'id', None) != getattr(me, 'id', None):
                mine_only = False
                break
        if mine_only:
            said.append('%sdelete the text #%s: its %d message(s) are all the '
                        'bot\'s own list' % (verb, KNOWN_NAME, n))
            if apply:
                await old.delete(reason=SETUP_REASON)
        else:
            archive = KNOWN_NAME + '-archive'
            said.append('%srename the text #%s to #%s and switch off sending in '
                        'it (it holds messages that are not the bot\'s, so '
                        'nothing is deleted)' % (verb, KNOWN_NAME, archive))
            if apply:
                await old.edit(name=archive, reason=SETUP_REASON)
                for t in list((getattr(old, 'overwrites', {}) or {})):
                    if t == me:
                        continue
                    ow = old.overwrites_for(t)
                    ow.update(**dict((x, False) for x in ARCHIVE_LOCK))
                    await old.set_permissions(t, overwrite=ow, reason=SETUP_REASON)
    findings = _channel_named(guild, FINDINGS_NAME)
    said += await _known_forum_make(guild, findings, apply, verb)
    tasks = _channel_named(guild, TASKS_NAME, ('forum',))
    me = getattr(guild, 'me', None)
    if tasks is not None and me is not None and not tasks.overwrites_for(me).manage_threads:
        said.append('%slet the bot delete posts in #%s (manage threads, for a '
                    'test task whose issue is reopened)' % (verb, TASKS_NAME))
        if apply:
            ow = tasks.overwrites_for(me)
            ow.update(view_channel=True, send_messages=True,
                      send_messages_in_threads=True, manage_threads=True)
            await tasks.set_permissions(me, overwrite=ow, reason=SETUP_REASON)
    if apply:
        state = _state_read(path) or {}
        rec = state.setdefault('guilds', {}).setdefault(str(guild.id), {})
        rec['known_forum'] = _utc_stamp()
        _state_write(path, state)
        said.append('recorded in %s, so this never runs again' % path)
    return said


def _setup_rec(guild, path=None):
    got = _state_read(path or SETUP_STATE) or {}
    rec = (got.get('guilds') or {}).get(str(getattr(guild, 'id', '')))
    return rec if isinstance(rec, dict) else {}


def _by_id(guild, cid):
    """The server's channel or category with this id, or None."""
    try:
        cid = int(cid or 0)
    except (TypeError, ValueError):
        return None
    if not cid:
        return None
    getter = getattr(guild, 'get_channel', None)
    return getter(cid) if getter is not None else None


def dev_tasks_forum(guild, path=None):
    """The #dev-test-tasks forum, by the id the setup recorded, or None when
       the setup has not made it or it has been deleted since. Never looked
       for by name: a rename keeps it."""
    ch = _by_id(guild, _setup_rec(guild, path).get('dev_tasks_id'))
    return ch if ch is not None and _kind(ch) == 'forum' else None


def dev_overwrites(guild, category, tasks=None):
    """
    #dev-test-tasks' overwrites: the category's copied, so it is staff only
    the way the category is, then the bot's own overwrite from #test-tasks
    with every forum right it needs there (FORUM_BOT_NEEDS) switched on.
    """
    out = _copy_overwrites(category) if category is not None else {}
    me = getattr(guild, 'me', None)
    if me is not None:
        mine = out.get(me) or discord.PermissionOverwrite()
        if tasks is not None and me in (getattr(tasks, 'overwrites', None) or {}):
            a, d = tasks.overwrites[me].pair()
            mine = discord.PermissionOverwrite.from_pair(a, d)
        mine.update(**dict((n, True) for n in FORUM_BOT_NEEDS))
        out[me] = mine
    return out


async def dev_tasks_setup(guild, apply=False, path=None):
    """
    The third one-time step (Patrick, 12 Oct): the #dev-test-tasks forum in
    the Staff category, staff only, tagged Dev. Recorded with its id as
    dev_tasks_id, so it runs once and the bot finds the forum by that id.
    Nothing to do when the recorded forum is still there.
    """
    path = path or SETUP_STATE
    verb = '' if apply else 'would '
    rec = _setup_rec(guild, path)
    if dev_tasks_forum(guild, path) is not None:
        return []
    said = []
    if rec.get('dev_tasks_id'):
        said.append('the #%s recorded in %s (id %s) is not on the server any '
                    'more' % (DEV_TASKS_NAME, path, rec.get('dev_tasks_id')))
    cat = _by_id(guild, DEV_TASKS_CATEGORY)
    if cat is None or _kind(cat) != 'category':
        return said + ['there is no category with id %d in "%s", so #%s was not '
                       'made. Set DEV_TASKS_CATEGORY in bot.env.json to the '
                       'Staff category\'s id and run this again.'
                       % (DEV_TASKS_CATEGORY, getattr(guild, 'name', '?'),
                          DEV_TASKS_NAME)]
    me = getattr(guild, 'me', None)
    there = [ch for ch in (getattr(cat, 'channels', None) or [])
             if str(getattr(ch, 'name', '')).lower() == DEV_TASKS_NAME]
    forum = next((ch for ch in there if _kind(ch) == 'forum'), None)
    if forum is None and there:
        return said + ['there is a #%s in %s that is not a forum, so nothing was '
                       'made. Rename or remove it by hand, then run this again.'
                       % (DEV_TASKS_NAME, getattr(cat, 'name', '?'))]
    if forum is not None:
        said.append('#%s is already in %s: %staken as it is, by its id %s'
                    % (DEV_TASKS_NAME, getattr(cat, 'name', '?'), verb, forum.id))
        if task_tag_of(forum, DEV_TAG) is None:
            said.append('%sadd the forum tag %s to #%s' % (verb, DEV_TAG, DEV_TASKS_NAME))
            if apply:
                tags = list(getattr(forum, 'available_tags', None) or [])
                tags.append(discord.ForumTag(name=DEV_TAG))
                await forum.edit(available_tags=tags, reason=SETUP_REASON)
        have = forum.overwrites_for(me) if me is not None else None
        if have is not None and not all(getattr(have, n) is True for n in FORUM_BOT_NEEDS):
            said.append('%slet the bot post, reply and delete its posts in #%s'
                        % (verb, DEV_TASKS_NAME))
            if apply:
                have.update(**dict((n, True) for n in FORUM_BOT_NEEDS))
                await forum.set_permissions(me, overwrite=have, reason=SETUP_REASON)
    else:
        tasks = _channel_named(guild, TASKS_NAME, ('forum',))
        said.append('%smake the forum #%s in %s with the category\'s %d '
                    'permission overwrite(s), so only the people who see %s '
                    'see it, and the tag %s'
                    % (verb, DEV_TASKS_NAME, getattr(cat, 'name', '?'),
                       len(getattr(cat, 'overwrites', {}) or {}),
                       getattr(cat, 'name', '?'), DEV_TAG))
        said.append('%sgive the bot its #%s rights there: see it, post, reply, '
                    'delete its posts and read them back' % (verb, TASKS_NAME))
        if apply:
            forum = await guild.create_forum(
                DEV_TASKS_NAME, category=cat,
                overwrites=dev_overwrites(guild, cat, tasks),
                topic=DEV_TOPIC,
                available_tags=[discord.ForumTag(name=DEV_TAG)],
                reason=SETUP_REASON)
    if apply:
        state = _state_read(path) or {}
        r = state.setdefault('guilds', {}).setdefault(str(guild.id), {})
        r['dev_tasks'] = _utc_stamp()
        r['dev_tasks_id'] = forum.id
        _state_write(path, state)
        said.append('recorded #%s (id %s) in %s, so this never runs again and '
                    'the bot finds it by that id' % (DEV_TASKS_NAME, forum.id, path))
    return said


# ------------------------------------------------------------ test tasks --
def is_task_poster(who):
    """Owner, Dev or Lead Gamemaster by TEST_TASK_ROLES. Nobody else."""
    try:
        ids, names = _role_tokens(TASK_ROLE_NAMES)
        return _who_hits(who, ids, names)
    except Exception:
        return False


def task_tag_of(forum, tag):
    """The forum's Dev or Main tag object, or None."""
    want = str(tag or '').strip().lower()
    for t in getattr(forum, 'available_tags', None) or []:
        if str(getattr(t, 'name', '')).lower() == want:
            return t
    return None


async def post_test_task(guild, title, body, tag=TASK_POST_TAG, path=None):
    """
    One thread, titled and tagged: Main (the default) in the #test-tasks
    forum, Dev in #dev-test-tasks, found by the id the one-time setup
    recorded (path, channel-setup.json). Any other tag is refused.

    Returns (thread or None, what to say). A thread already open under that
    exact title in that forum is not made twice; the existing one is handed
    back.
    """
    title = str(title or '').strip()
    body = str(body or '').strip()
    want = str(tag or TASK_POST_TAG).strip().capitalize()
    if want not in HAND_TAGS:
        return None, ('A test task is Main (for testers, in #%s) or Dev (for '
                      'staff on dev, in #%s), not %r.'
                      % (TASKS_NAME, DEV_TASKS_NAME, tag))
    if not title or not body:
        return None, 'A test task needs a title and a body.'
    if len(title) > TASK_TITLE_ROOM:
        return None, 'That title is %d characters; Discord takes %d.' % (
            len(title), TASK_TITLE_ROOM)
    if len(body) > TASK_BODY_ROOM:
        return None, 'That body is %d characters; Discord takes %d.' % (
            len(body), TASK_BODY_ROOM)
    if want == 'Dev':
        name = DEV_TASKS_NAME
        forum = dev_tasks_forum(guild, path)
        if forum is None:
            return None, ('#%s is not made yet. The one-time setup (python '
                          'bot.py --setup-channels --apply) makes it.' % name)
    else:
        name = TASKS_NAME
        forum = _channel_named(guild, TASKS_NAME, ('forum',))
        if forum is None:
            return None, ('#%s is not a forum yet. The one-time setup '
                          '(python bot.py --setup-channels --apply) makes it one.'
                          % TASKS_NAME)
    t = task_tag_of(forum, want)
    if t is None:
        return None, ('#%s has no %s tag. The one-time setup adds it.'
                      % (name, want))
    for th in list(getattr(forum, 'threads', None) or []):
        if (str(getattr(th, 'name', '')) == title
                and not getattr(th, 'archived', False)):
            return th, 'Already there: %s' % getattr(th, 'mention', title)
    made = await forum.create_thread(name=title, content=body,
                                     applied_tags=[t],
                                     reason='Thornswood test task')
    thread = getattr(made, 'thread', made)
    return thread, 'Posted: %s' % getattr(thread, 'mention', title)


@tree.command(name='test-task',
              description='Post a test task: Main for testers (#test-tasks), '
                          'Dev for staff on dev. Owner, Dev, Lead GM.')
@discord.app_commands.describe(title='The thread title.',
                               body='What to test, as the first post.',
                               tag='Main (the default): testers on main, in '
                                   '#test-tasks. Dev: staff on dev, in '
                                   '#dev-test-tasks.')
async def test_task_cmd(interaction: discord.Interaction, title: str,
                        body: str, tag: typing.Literal['Main', 'Dev'] = 'Main'):
    if interaction.guild is None:
        await _say(interaction, 'This one works in the server.')
        return
    if not is_task_poster(interaction.user):
        await _say(interaction, 'Only %s post test tasks.'
                   % ', '.join(TASK_ROLE_NAMES))
        return
    await interaction.response.defer(ephemeral=True, thinking=True)
    try:
        _, said = await post_test_task(interaction.guild, title, body, tag)
    except discord.HTTPException as e:
        log('test task: Discord refused a post: %s' % getattr(e, 'text', e))
        said = ('That did not go through. In #%s the bot needs View Channel, '
                'Send Messages and Create Posts.'
                % (DEV_TASKS_NAME if tag == 'Dev' else TASKS_NAME))
    await interaction.followup.send(said, ephemeral=True)


# ---------------------------------------------------------- known issues --
#
# Patrick, 11 Oct: the issue board is not where testers look. Two forums are
# kept from it, automatically, as things are found and fixed:
#
#   #known-issues  one post per open issue labelled Dev Findings or Main
#                  Findings, tagged Dev or Main by its labels (where it was
#                  found). The post goes the moment its issue is no longer an
#                  open finding: fixed and closed, closed any other way, or its
#                  label taken off.
#   #test-tasks    one post per issue closed as fixed from the day this began
#                  (see the since stamp below), for testers to check. Its
#                  title and body are the issue's last comment that starts
#                  "Test task:" (written by whoever fixed it); a finding with
#                  no such comment gets its own title and a plain line. An
#                  issue that is reopened loses its test task, and comes back
#                  to #known-issues if it is still a finding.
#
# When an issue closes (Patrick, 11 Oct): dev is where the team checks that
# nothing breaks the game, and main is where testers test, since we are in
# alpha. So a fix people would notice is closed, with its "Test task:"
# comment, when it reaches main, not when it merges or reaches dev, and every
# test task the bot posts in #test-tasks is tagged Main. A "Server:" line
# under "Known issue:" still sets that post's tag.
#
#   #dev-test-tasks (Patrick, 12 Oct) one post per issue whose last "Test
#                  task:" comment has "Server: Dev" straight under it, open or
#                  closed: the code is done and someone on dev has to measure
#                  something. Most test tasks are Main, because testers play
#                  on main. The post goes when the issue closes as fixed (any
#                  close after the comment), or when a newer "Test task:"
#                  comment does not say Server: Dev; a closed issue's newest
#                  test task then goes to #test-tasks as before, if it is
#                  Main. An issue whose last test task says Server: Dev gets
#                  no #test-tasks post from it. A dev post is for developers
#                  (Patrick, 12 Oct): the issue, its pull requests, commits,
#                  labels and build linked, and the whole test task over as
#                  many messages as it takes (dev_render). #test-tasks posts
#                  stay plain, with no number, link or code.
#
# "Server: Dev" counts only on a comment written from the day #dev-test-tasks
# began (state['dev_since'], set on the first pass that finds the forum).
# Comments from before that carried "Server: Dev" when every test task went
# to #test-tasks; they stay Main, so no post already up moves. Until the
# forum is made, every Server line is read and changes nothing, as before.
#
# Each record holds the form of the post it was made with (TASK_FORM,
# KNOWN_FORM). When the way a post is written changes, the form goes up by
# one, and every record of an older form is written again on the next pass,
# once, even though GitHub says its issue did not change.
#
# Posts carry no issue number and no link: testers have no GitHub. The bot
# remembers which post is which issue in known-issues.json in the data folder,
# written straight after each post, so a restart never posts twice; a post
# made just before a crash is found again by its title among the bot's own.
#
# GitHub: the token github_token() gives, for the issues of KNOWN_ISSUES_REPO
# (read, and write for the comments and filed problems). No token means
# neither forum is kept, said once.
KNOWN_REPO = os.environ.get('KNOWN_ISSUES_REPO', 'ThornswoodRP/Thornswood').strip()
KNOWN_LABELS = [l.strip() for l in
                os.environ.get('KNOWN_ISSUES_LABELS',
                               'Dev Findings,Main Findings').split(',')
                if l.strip()]
KNOWN_EVERY = max(60, _int_env('KNOWN_ISSUES_EVERY', 300))
GITHUB_API = os.environ.get('GITHUB_API', 'https://api.github.com').rstrip('/')
TASK_MARK = re.compile(r'^\s*test task\s*:\s*(.*)$', re.I)
KNOWN_MARK = re.compile(r'^\s*known issue\s*:\s*(.*)$', re.I)
TASK_SERVER = re.compile(r'^\s*server\s*:\s*(dev|main)\s*$', re.I)
# The one tag a test task from the board carries: testers test on main.
TASK_TAG = 'Main'
# The form of the posts each record was made with. 2: test tasks tagged Main
# whatever their Server line, and both bodies say the fix is on main (11 Oct).
# 3 (and KNOWN_FORM 3, DEV_FORM 2): the Claude Code line under a comment is
# not in the post (22 Oct).
# 4 (and KNOWN_FORM 4, DEV_FORM 3): no post ends with a "---" rule or any
# "Generated by/with" footer (Patrick, 22 Oct).
# KNOWN_FORM 5: done-on-merge.yml's comment takes a known post down
# (merged_fix, 26 Oct), so every finding's comments are read again once.
TASK_FORM = 4
KNOWN_FORM = 5
DEV_FORM = 3
# A fix that is merged and waits on main: done-on-merge.yml's comment,
# written by the workflow and starting "Pull request #N merged (", which
# Close-ShippedIssues.ps1 reads as well. Until #5185 a board: Done label went
# on beside it for a minute; the card follows the merge by itself now
# (board.yml), and the comment is the one mark.
DONE_ON_MERGE = re.compile(r'^Pull request #\d+ merged \(')
DONE_ON_MERGE_BY = 'github-actions[bot]'


def merged_fix(comments):
    """True when done-on-merge.yml has written its record of a merged fix
       on the issue: the issue is in Done and its fix has landed."""
    for c in comments or []:
        who = str(((c.get('user') or {}).get('login')) or '')
        if who == DONE_ON_MERGE_BY and DONE_ON_MERGE.match(str(c.get('body') or '')):
            return True
    return False


# The token the box admin service's App makes for the bot (#5184, Patrick's A
# of 1 Nov 2026): issues write on KNOWN_REPO alone, for the hour GitHub gives
# it, written by scripts\vps\admin\admin.js every half hour into a folder
# only SYSTEM, Administrators, that service and this bot's own account may
# read. It replaces GITHUB_TOKEN, a fine-grained token of Patrick's bound to
# EvilPatrick06, which writes nothing once the repository is ThornswoodRP's.
GITHUB_TOKEN_FILE = os.environ.get(
    'GITHUB_TOKEN_FILE', r'C:\Thornswood-Admin\for-bot\github-token.json').strip()
_TOKEN_SAID = {'line': ''}


def _token_from_file(path=None, now=None):
    """(token, why): the App's token in GITHUB_TOKEN_FILE while it has more
       than two minutes left, else ('', why there is none). Never the token
       in why."""
    path = GITHUB_TOKEN_FILE if path is None else path
    now = time.time() if now is None else now
    if not path:
        return '', 'no GITHUB_TOKEN_FILE'
    try:
        with open(path, encoding='utf-8') as f:
            doc = json.load(f)
    except FileNotFoundError:
        return '', '%s is not there' % path
    except (OSError, ValueError) as e:
        return '', '%s will not read (%s)' % (path, type(e).__name__)
    token = str((doc or {}).get('token') or '').strip() if isinstance(doc, dict) else ''
    ends = str((doc or {}).get('expires_at') or '') if isinstance(doc, dict) else ''
    if not token:
        return '', '%s holds no token' % path
    try:
        left = datetime.datetime.strptime(ends, '%Y-%m-%dT%H:%M:%SZ').replace(
            tzinfo=datetime.timezone.utc).timestamp() - now
    except ValueError:
        return '', '%s says no time it ends' % path
    if left < 120:
        return '', 'the token in %s ended at %s' % (path, ends)
    return token, ''


def github_token(path=None, now=None):
    """The token for KNOWN_REPO's issues: the App's from GITHUB_TOKEN_FILE
       while it has one, else GITHUB_TOKEN. Says in the log each time the
       one it uses changes, and why, never the token."""
    token, why = _token_from_file(path, now)
    if token:
        line = 'github: the App\'s token from %s' % (GITHUB_TOKEN_FILE if path is None else path)
    else:
        token = os.environ.get('GITHUB_TOKEN', '').strip()
        line = 'github: %s, so %s' % (why, 'GITHUB_TOKEN from bot.env.json' if token else 'no token')
    if line != _TOKEN_SAID['line']:
        _TOKEN_SAID['line'] = line
        log(line)
    return token


def _github_get(url):
    token = github_token()
    req = urllib.request.Request(url, headers={
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        'User-Agent': 'thornswood-bot',
        'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode('utf-8'))


def pass_failure(e):
    """How a pass failed, for the log: the kind, and for an answer from
       GitHub its status and the path it asked for, so a failure names
       itself (#5184: 110 lines saying only "HTTPError"). Never the token:
       the request carries it in a header, and neither the path nor str(e)
       holds it."""
    kind = type(e).__name__
    if isinstance(e, urllib.error.HTTPError):
        url = str(getattr(e, 'url', None) or getattr(e, 'filename', None) or '')
        path = url[len(GITHUB_API):] if url.startswith(GITHUB_API) else url.split('?')[0]
        return '%s %s on %s' % (kind, getattr(e, 'code', '?'), path or '(no path)')
    if isinstance(e, urllib.error.URLError):
        return '%s (%s)' % (kind, type(getattr(e, 'reason', None)).__name__)
    return kind


def _github_rows(got, url):
    """A page of a GitHub list, which is a list. Anything else is an answer
       that is not the list, and is raised, never read as no issues: a pass
       that read no findings would take every #known-issues post down."""
    if got is None:
        return []
    if not isinstance(got, list):
        raise ValueError('GitHub answered %s with a %s, not a list'
                         % (url.split('?')[0], type(got).__name__))
    return got


def github_open_findings(get=None):
    """Every open issue (not pull request) carrying one of KNOWN_LABELS, by
       number. One query per label because GitHub ANDs labels in one."""
    get = get or _github_get
    out = {}
    for label in KNOWN_LABELS:
        page = 1
        while True:
            url = ('%s/repos/%s/issues?state=open&per_page=100&page=%d&labels=%s'
                   % (GITHUB_API, KNOWN_REPO, page,
                      urllib.parse.quote(label)))
            rows = _github_rows(get(url), url)
            for row in rows:
                if isinstance(row, dict) and 'pull_request' not in row:
                    out.setdefault(int(row['number']), row)
            if len(rows) < 100:
                break
            page += 1
    return out


def github_closed_since(since, get=None):
    """Every issue (not pull request) that is closed and was updated at or
       after since, an ISO stamp, by number. A close and a new comment both
       move the update time, so this holds every issue closed since then and
       every closed issue with a comment since then."""
    get = get or _github_get
    out = {}
    page = 1
    while True:
        url = ('%s/repos/%s/issues?state=closed&per_page=100&page=%d'
               '&sort=updated&direction=desc&since=%s'
               % (GITHUB_API, KNOWN_REPO, page, urllib.parse.quote(since)))
        rows = get(url) or []
        for row in rows:
            if isinstance(row, dict) and 'pull_request' not in row:
                out.setdefault(int(row['number']), row)
        if len(rows) < 100:
            break
        page += 1
    return out


def github_changed_since(since, get=None):
    """Every issue (not pull request), open or closed, updated at or after
       since, by number. A new comment, a close and a reopen all move the
       update time, so this holds every issue whose dev test task can have
       come or gone since then."""
    get = get or _github_get
    out = {}
    page = 1
    while True:
        url = ('%s/repos/%s/issues?state=all&per_page=100&page=%d'
               '&sort=updated&direction=asc&since=%s'
               % (GITHUB_API, KNOWN_REPO, page, urllib.parse.quote(since)))
        rows = get(url) or []
        for row in rows:
            if isinstance(row, dict) and 'pull_request' not in row:
                out.setdefault(int(row['number']), row)
        if len(rows) < 100:
            break
        page += 1
    return out


# What KNOWN_REPO is called now, once GitHub has been asked (#5184).
_KNOWN_REPO_NOW = {'name': ''}


def known_repo_now(get=None, again=False):
    """owner/name GitHub gives KNOWN_REPO now, asked once a process (again
       asks anew). A repository moved to another owner keeps its issues and
       GET /repos/KNOWN_REPO follows the move to its new name, but GitHub
       answers a POST to the old name with a 307 that urllib does not follow,
       so the bot's writes go to this name. A failure to ask raises."""
    if _KNOWN_REPO_NOW['name'] and not again:
        return _KNOWN_REPO_NOW['name']
    get = get or _github_get
    repo = get('%s/repos/%s' % (GITHUB_API, KNOWN_REPO))
    now = str(repo.get('full_name') or '').strip() if isinstance(repo, dict) else ''
    if '/' not in now:
        raise ValueError('GitHub answered %s with no full_name' % KNOWN_REPO)
    _KNOWN_REPO_NOW['name'] = now
    return now


def is_known_repo(name, get=None):
    """Whether owner/name is KNOWN_REPO, under the name it was given or the
       one GitHub gives it now. A name that is neither is held to a fresh
       answer before it counts as another repository. A failure to ask
       raises, and the pass that asked changes nothing."""
    name = str(name or '').strip().lower()
    if not name:
        return False
    if name in (KNOWN_REPO.lower(), _KNOWN_REPO_NOW['name'].lower()):
        return True
    return name == known_repo_now(get, again=True).lower()


def github_token_kind(token=None):
    """What kind of token github_token() gives, by its prefix, never the
       token. A fine-grained token is bound to one owner and reaches nothing
       of the repository once it moves to another (#5184), so the bot says
       the kind at start, where Get-Logs reads it."""
    token = github_token() if token is None else token
    token = str(token).strip()
    for prefix, kind in (('github_pat_', 'fine-grained'), ('ghp_', 'classic'),
                         ('ghs_', 'app installation'), ('gho_', 'oauth')):
        if token.startswith(prefix):
            return kind
    return 'no' if not token else 'unknown'


def github_issue(number, get=None):
    get = get or _github_get
    return get('%s/repos/%s/issues/%d' % (GITHUB_API, KNOWN_REPO, int(number)))


def finding_gone(number, get=None):
    """Why issue number is no longer an open finding, read from the issue
       itself, or None when it still is one: open, in KNOWN_REPO, carrying
       one of KNOWN_LABELS.

       The label lists (github_open_findings) are not the issue. On 22 Oct
       one list, then the other, then both came back from GitHub without
       issues that were open and labelled the whole time (no label, close or
       reopen on their timelines), and the same ten #known-issues posts came
       down and went back up as a set three times in one process (#3438).
       So a post whose issue a list left out comes down on this answer, not
       on the list's. Any other failure to read raises, and the pass that
       asked changes nothing."""
    try:
        issue = github_issue(number, get)
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            return 'GitHub has no issue #%d any more (%d)' % (int(number), e.code)
        raise
    if not isinstance(issue, dict):
        raise ValueError('GitHub answered issue #%d with a %s, not an issue'
                         % (int(number), type(issue).__name__))
    where = str(issue.get('repository_url') or '').lower().split('/repos/')[-1]
    if not is_known_repo(where, get):
        return 'it moved to %s' % (where or 'another repository')
    if str(issue.get('state')) != 'open':
        return 'it is closed'
    if not issue_tags_found(issue):
        return 'it no longer carries %s' % ' or '.join(KNOWN_LABELS)
    return None


def github_comments(number, get=None):
    get = get or _github_get
    out, page = [], 1
    while True:
        rows = get('%s/repos/%s/issues/%d/comments?per_page=100&page=%d'
                   % (GITHUB_API, KNOWN_REPO, int(number), page)) or []
        out += [r for r in rows if isinstance(r, dict)]
        if len(rows) < 100:
            break
        page += 1
    return out


def github_timeline(number, get=None):
    get = get or _github_get
    out, page = [], 1
    while True:
        rows = get('%s/repos/%s/issues/%d/timeline?per_page=100&page=%d'
                   % (GITHUB_API, KNOWN_REPO, int(number), page)) or []
        out += [r for r in rows if isinstance(r, dict)]
        if len(rows) < 100:
            break
        page += 1
    return out


def _labels(issue):
    return [str((l or {}).get('name') if isinstance(l, dict) else l)
            for l in (issue.get('labels') or [])]


def issue_tags(issue, server=None):
    """The #known-issues tags: Dev, Main or both, from the findings labels;
       server ('Dev' or 'Main') when a "Known issue:" comment names one; Dev
       when nothing says. Test tasks do not use this: they are TASK_TAG."""
    if server:
        return [server.capitalize()]
    names = _labels(issue)
    tags = [t for t in TASK_TAGS if ('%s Findings' % t) in names]
    return tags or ['Dev']


def known_title(issue):
    return short_title(str(issue.get('title') or '').strip() or 'untitled')


def short_title(text, room=45):
    """text cut to room characters at a word, for a title the bot makes
       itself from the issue's (a post title is 45 at most, Patrick 22 Oct)."""
    text = str(text or '').strip()
    if len(text) <= room:
        return text
    cut = text[:room + 1].rsplit(' ', 1)[0].rstrip(' ,.;:-')
    return cut if cut else text[:room]


def known_body(issue):
    where = ' and '.join(issue_tags(issue))
    return ('Known on %s. The team is working on it. This post goes when the '
            'fix is on main, and then it comes back as a test task.' % where)


# The line GitHub puts under every comment a Claude session writes (a rule,
# then "_Generated by [Claude Code](...)_"). It is not part of the test task,
# and a post carries no link (22 Oct: it showed in #test-tasks posts).
# Patrick, 22 Oct: no #test-tasks, #dev-test-tasks or #known-issues post ends
# with a footer. Any trailing "Generated by/with Claude Code" or
# "\U0001f916 Generated with" line goes, and so does a trailing "---" rule.
FOOTER_LINE = re.compile(r'^\s*(?:\U0001f916\s*)?[_*]*\s*Generated\s+(?:by|with)\b.*$'
                         r'|^\s*\U0001f916\s*Generated with\b.*$', re.I)
FOOTER_RULE = re.compile(r'^\s*(?:-{3,}|\*{3,}|_{3,})\s*$')
CLAUDE_WORDS = re.compile(r'claude', re.I)


def strip_footer(text):
    """text without the footer at its end: trailing blank lines, "---"
       rules and "Generated by/with Claude Code" (or "\U0001f916 Generated
       with") lines, as many as there are, and nothing above them."""
    lines = str(text or '').replace('\r\n', '\n').split('\n')
    while lines:
        last = lines[-1]
        if not last.strip() or FOOTER_RULE.match(last):
            lines.pop()
        elif FOOTER_LINE.match(last) and (CLAUDE_WORDS.search(last)
                                         or last.lstrip().startswith('\U0001f916')):
            lines.pop()
        else:
            break
    return '\n'.join(lines)


CLAUDE_FOOTER = re.compile(r'\n*^-{3,}[ \t]*\n+_Generated by \[Claude Code\]\([^)\n]*\)_\s*\Z',
                           re.M)


def _all_marked(issue, comments, mark, room=TASK_BODY_ROOM):
    """Every comment of the issue whose first line matches mark ("Test task:"
       or "Known issue:"), oldest first, as (title, body, server or None,
       created_at, comment address). A first line with nothing after the
       colon takes the issue's own title. The Claude Code line under a
       comment is not part of the body. The body is cut at room characters,
       the most a first post takes; room None keeps all of it."""
    out = []
    for c in comments or []:
        text = strip_footer(CLAUDE_FOOTER.sub('', str(c.get('body') or '').replace('\r\n', '\n').strip()))
        lines = text.strip().split('\n')
        m = mark.match(lines[0]) if lines else None
        if not m:
            continue
        title = (m.group(1).strip() or known_title(issue))[:TASK_TITLE_ROOM]
        rest = lines[1:]
        server = None
        if rest and TASK_SERVER.match(rest[0]):
            server = TASK_SERVER.match(rest[0]).group(1).capitalize()
            rest = rest[1:]
        body = '\n'.join(rest).strip()
        if room is not None:
            body = body[:room]
        out.append((title, body, server, str(c.get('created_at') or ''),
                    str(c.get('html_url') or '')))
    return out


def _marked(issue, comments, mark, room=TASK_BODY_ROOM):
    """The last of _all_marked, or None."""
    got = _all_marked(issue, comments, mark, room)
    return got[-1] if got else None


def task_list(issue, comments, dev_since=None):
    """Every "Test task:" comment, oldest first, as (title, body, server,
       created_at, comment address). server is 'Dev' when a "Server: Dev"
       line is straight under it and the comment was written at or after
       dev_since, the day #dev-test-tasks began; 'Main' otherwise, so a
       Server line from before that day, or with no dev_since at all, is read
       and changes nothing. A Dev body is kept whole (it is for developers,
       and posted over as many messages as it takes); a Main body is cut to
       one first post, as it always was."""
    out = []
    for title, body, server, created, url in _all_marked(issue, comments,
                                                         TASK_MARK, room=None):
        if server == 'Dev' and dev_since and created >= dev_since:
            out.append((title, body or 'Measure this on dev.', 'Dev', created, url))
        else:
            out.append((title, body[:TASK_BODY_ROOM] or 'Check this on main.',
                        'Main', created, url))
    return out


def last_task(issue, comments, dev_since=None):
    """The last "Test task:" comment (task_list's tuple), Dev or Main, or None."""
    got = task_list(issue, comments, dev_since)
    return got[-1] if got else None


def main_task_of(issue, comments, dev_since=None):
    """The issue's Main test task: its last "Test task:" comment that is not
       Dev (task_list's tuple), or None. A newer Dev one beside it does not
       hide it: the two are for different people (Patrick, 22 Oct)."""
    got = [t for t in task_list(issue, comments, dev_since) if t[2] == 'Main']
    return got[-1] if got else None


def test_task_of(issue, comments, dev_since=None):
    """(title, body, created_at) from the issue's Main test task, or None. A
       Server line under it is read so it is not in the body."""
    got = main_task_of(issue, comments, dev_since)
    if got is None:
        return None
    return got[0], got[1], got[3]


def dev_task_of(issue, comments, dev_since):
    """The issue's dev test task (task_list's tuple), or None: its last
       "Test task:" comment saying Server: Dev. Open issue or closed, and
       whatever Main one is beside it: the two are for different people, and
       a check only a dev can do stays up after the fix reaches main
       (Patrick, 22 Oct), so the main Ship writing the Main one does not take
       it down. It goes when its comment is taken back or staff close the
       post; a newer Dev one replaces it."""
    if not dev_since:
        return None
    got = [t for t in task_list(issue, comments, dev_since) if t[2] == 'Dev']
    return got[-1] if got else None


def fix_refs(timeline, get=None):
    """
    (pull requests, commits) from the issue's timeline: every pull request of
    KNOWN_REPO that mentions the issue and is merged or still open, as dicts
    of number, title, url and merged_at, by number; and every commit of
    KNOWN_REPO whose message names the issue, by sha, in the order GitHub
    saw them. A pull request closed without merging carries nothing, so it
    is left out. Read from the timeline alone, which the bot's issues token
    reads; a commit there may be a branch commit as well as a merge.
    """
    prs, commits = {}, []
    for ev in timeline or []:
        if not isinstance(ev, dict):
            continue
        if ev.get('event') == 'cross-referenced':
            src = (ev.get('source') or {}).get('issue') or {}
            pr = src.get('pull_request')
            if not isinstance(pr, dict) or 'number' not in src:
                continue
            repo = str((src.get('repository') or {}).get('full_name') or '')
            if repo and not is_known_repo(repo, get):
                continue
            if src.get('state') == 'closed' and not pr.get('merged_at'):
                continue
            prs[int(src['number'])] = {
                'number': int(src['number']),
                'title': str(src.get('title') or '').strip(),
                'url': str(src.get('html_url') or ''),
                'merged_at': pr.get('merged_at')}
        elif ev.get('event') == 'referenced' and ev.get('commit_id'):
            m = re.search(r'/repos/([^/]+/[^/]+)/commits/', str(ev.get('commit_url') or ''))
            if not m or not is_known_repo(m.group(1), get):
                continue
            sha = str(ev['commit_id'])
            if sha not in commits:
                commits.append(sha)
    return [prs[n] for n in sorted(prs)], commits


BUILD_LINE = re.compile(r'^\s*(?:needs\s+)?build\s*:\s*(\S.*?)\s*$', re.I | re.M)


def dev_render(issue, task, prs=(), commits=()):
    """
    (title, body, tags) for a #dev-test-tasks post (Patrick, 12 Oct: the dev
    one is for developers with GitHub, so it links the issue, its pull
    requests and commits, its labels and the build it needs, and keeps the
    test task whole, in developer terms if it was written that way). The
    body can be longer than one message; dev_chunks splits it.
    #test-tasks never gets any of this.
    """
    title, body, _server, _created, comment_url = task
    url = str(issue.get('html_url') or '')
    site = url.split('/issues/')[0] if '/issues/' in url else ''
    state = str(issue.get('state') or 'open')
    if state != 'open':
        state += ' (%s)' % (issue.get('state_reason') or 'completed').replace('_', ' ')
    head = ['**Issue:** #%s %s <%s>' % (issue.get('number'),
                                        str(issue.get('title') or '').strip(), url),
            '**State:** %s' % state]
    labels = _labels(issue)
    if labels:
        head.append('**Labels:** %s' % ', '.join(labels))
    if prs:
        head.append('**Pull requests:**')
        for pr in prs:
            head.append('- #%d %s, %s <%s>' % (
                pr['number'], pr['title'],
                ('merged %s' % pr['merged_at']) if pr.get('merged_at') else 'not merged yet',
                pr['url']))
    if commits:
        head.append('**Commits naming the issue:**')
        for sha in commits:
            head.append('- `%s` <%s/commit/%s>' % (sha[:10], site, sha))
    build = BUILD_LINE.search(body) or BUILD_LINE.search(str(issue.get('body') or ''))
    if build:
        head.append('**Build:** %s' % build.group(1))
    if comment_url:
        head.append('**Test task comment:** <%s>' % comment_url)
    return title, strip_footer('\n'.join(head) + '\n\n' + strip_footer(body)), [DEV_TAG]


def dev_chunks(text, room=TASK_BODY_ROOM):
    """The text in pieces of at most room characters (Discord's limit for one
       message), cut between lines; a line longer than that is cut where it
       has to be. Nothing is dropped: the first piece is the post, the rest go
       in the thread after it, in order."""
    out, cur = [], ''
    for line in str(text or '').split('\n'):
        while len(line) > room:
            if cur:
                out.append(cur)
                cur = ''
            out.append(line[:room])
            line = line[room:]
        joined = line if not cur else cur + '\n' + line
        if len(joined) > room:
            out.append(cur)
            cur = line
        else:
            cur = joined
    if cur.strip():
        out.append(cur)
    return [c for c in out if c.strip()] or ['(empty)']


# The rules every post is checked against before it goes up (Patrick, 22
# Oct: "the bot checks every rule, in all three channels, before it posts").
# A post that breaks one is not made, nor is a post already up edited to the
# bad version; the issue gets one comment naming the rules broken, so the
# thread that owns it fixes it, and the bot tries again on its next pass.
POST_TITLE_ROOM = 45
# Off only in tests of the forum passes that predate the rules; the rules
# have their own test (test-post-rules.py).
POST_RULES = True
STEP_LINE = re.compile(r'^\s*\d+[.)]\s+\S', re.M)
ISSUE_NUMBER = re.compile(r'(?<![\w&])#\d+\b')
LINK = re.compile(r'https?://|www\.', re.I)
CODE = re.compile(r'`')
# Built from its code point, never pasted, as Check-Words.ps1 explains.
EM_DASH = re.compile(chr(0x2014) + r'|&mdash;|&#8212;|&#x2014;', re.I)
BANNED_WORD = re.compile(r'\bplayers?\b', re.I)
# Steps a Claude, the Desk, a harness, a workflow or a command can do: a
# dev test task is only for what a human dev must do in the game.
AUTOMATABLE = re.compile(
    r'\bclaude\b|\bthe desk\b|\bthe box\b|\bon the box\b|\bvps\b|\bharness'
    r'|\bworkflow\b|\bpowershell\b|\bcurl\b|\bssh\b|\bscript\b|\.ps1\b|\.py\b'
    r'|\bbot\.py\b|\bget-content\b|\bget-filehash\b|\bremote\.ps1'
    r'|\bserver\.log\b|\bserver log\b|\blauncher\.log\b|\bskyrim-platform\.log\b'
    r'|\bgamemode log\b|\blogs?\b(?=[^.\n]*\b(?:count|read|copy|look|check|grep)\b)'
    r'|\b(?:count|read|copy|check)\b[^.\n]*\blogs?\b'
    r'|\bstaff[- ]notice\b|\bmanifest\b', re.I)
# What makes a check a dev's and not a playtester's: a staff or dev command,
# the dev build (offered only to staff) or something only staff can set up.
DEV_ONLY = re.compile(
    r'(?:^|\s)/(?!helpme\b)[a-z]+|\bstaff\b|\bdev command|\badmin\b'
    r'|\bdev (?:build|launcher|install|release)\b|\bswitch(?:ed)?\b'
    r'|\bhand-?edit|\bsettings file\b|\bskse loader\b', re.I)
# A staff or dev command in a main test task, which every playtester runs.
STAFF_STEP = re.compile(
    r'(?:^|\s)/(?:tp|give|spawn|kick|ban|god|heal|npcs?|time|weather|item|gold'
    r'|setrank|rank|mute|summon|teleport|debug)\b|\bstaff command|\bdev command'
    r'|\badmin\b', re.I)


def _steps(body):
    return [l for l in str(body or '').split('\n') if STEP_LINE.match(l)]


def task_server_line(issue, comments, url):
    """The Server line written straight under the "Test task:" comment at
       url ('Dev' or 'Main'), or None when it has none."""
    for got in _all_marked(issue, comments, TASK_MARK, room=None):
        if got[4] == url:
            return got[2]
    return None


def post_problems(channel, title, body, *, server=None, issue=None,
                  merged_pr=False, has_task=False, fix_in_main=None,
                  taken_titles=()):
    """
    The rules the post breaks, in words for the issue comment; empty when
    it may go up. channel is 'dev', 'main' (#test-tasks) or 'known'. body is
    the post's text as written on the issue (before dev_render adds the
    links a dev post carries). server is the Server line the comment had.
    fix_in_main is True or False when the latest main release was read
    (None: not known, not refused for it). taken_titles are the titles other
    issues already hold in this channel.
    """
    out = []
    text = str(body or '')
    lines = text.split('\n')
    if any(FOOTER_RULE.match(l) for l in lines) or any(
            FOOTER_LINE.match(l) and (CLAUDE_WORDS.search(l) or '\U0001f916' in l)
            for l in lines):
        out.append('Footer: the text has a "---" line or a "Generated by/with '
                   'Claude Code" line; no post carries either.')
    if len(str(title or '')) > POST_TITLE_ROOM:
        out.append('Format: the title is %d characters; it may be %d at most.'
                   % (len(str(title)), POST_TITLE_ROOM))
    if str(title or '') in set(taken_titles):
        out.append('Duplicates: another issue already has a post titled "%s" '
                   'in this channel; one post per issue.' % title)
    if ISSUE_NUMBER.search(text) or LINK.search(text) or CODE.search(text):
        out.append('Format: the text has an issue number, a link or code; '
                   'posts carry none.')
    if channel in ('known', 'roadmap'):
        # The site shows these two to anybody (#3140), so the writing rules
        # every public page keeps hold here too (Check-Words.ps1 reads the
        # repository; these words are on GitHub, so the bot reads them).
        words = '%s\n%s' % (title or '', text)
        if EM_DASH.search(words):
            out.append('Words: the text has an em dash; nothing written for '
                       'people has one.')
        if BANNED_WORD.search(words):
            out.append('Words: the text says "player"; write "people", '
                       '"characters" or "testers" instead.')
    if channel == 'roadmap':
        if not text.strip():
            out.append('Roadmap: the "Roadmap:" comment has nothing under its '
                       'first line, which is where the work stands.')
        return out
    if channel == 'known':
        if issue is not None and str(issue.get('state')) != 'open':
            out.append('Known issues: the issue is closed.')
        if merged_pr:
            out.append('Known issues: a merged pull request names the issue.')
        if has_task:
            out.append('Known issues: the issue has a "Test task:" comment.')
        return out
    want = 'Dev' if channel == 'dev' else 'Main'
    if server != want:
        out.append('Format: the line under "Test task:" must be "Server: %s" '
                   'for this channel.' % want)
    steps = _steps(text)
    if not steps:
        out.append('Format: the steps are not numbered (1. 2. 3.).')
    if channel == 'dev':
        auto = [s.strip() for s in steps if AUTOMATABLE.search(s)]
        if auto:
            out.append('Dev test tasks: a Claude, the Desk, a harness, a '
                       'workflow or a command can do these steps, so they '
                       'run them and post the result instead (a "Check '
                       '(Claude):" comment): ' + ' / '.join(a[:80] for a in auto[:3]))
        if steps and not any(DEV_ONLY.search(s) for s in steps):
            out.append('Dev test tasks: these are ordinary playtester steps '
                       'with no staff or dev command; that is a Main test '
                       'task, written once a main release carries the fix.')
    else:
        if fix_in_main is False:
            out.append('Main test tasks: the fix commit is not in the latest '
                       'main release yet.')
        staff = [s.strip() for s in steps if STAFF_STEP.search(s)]
        if staff:
            out.append('Main test tasks: these steps need staff or dev '
                       'commands, which makes it a Dev test task: '
                       + ' / '.join(s[:80] for s in staff[:3]))
    return out


def github_say(number, text):
    """Comments text on the issue. The bot's token needs issues write for
       this; when it cannot, the refusal is only logged."""
    token = github_token()
    req = urllib.request.Request(
        '%s/repos/%s/issues/%d/comments' % (GITHUB_API, known_repo_now(), int(number)),
        data=json.dumps({'body': text}).encode('utf-8'), method='POST',
        headers={'Accept': 'application/vnd.github+json',
                 'Authorization': 'Bearer ' + token,
                 'User-Agent': 'thornswood-bot',
                 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode('utf-8'))


CHANNEL_NAMES = {'dev': 'dev-test-tasks', 'main': 'test-tasks',
                 'known': 'known-issues'}
# Where each kind of post goes, as the refusal comment says it.
POST_PLACES = {'dev': 'in #dev-test-tasks', 'main': 'in #test-tasks',
               'known': 'in #known-issues', 'roadmap': "on the site's roadmap"}


def refuse(state, channel, num, problems, say=None):
    """Remembers that the post for issue num in channel breaks problems and
       comments that on the issue once (again only when the rules broken
       change). With no problems, forgets any earlier refusal and returns
       False; otherwise True: the caller does not post."""
    if not POST_RULES:
        return False
    seen = state.setdefault('refused', {})
    key = '%s:%s' % (channel, num)
    if not problems:
        if seen.pop(key, None) is not None:
            state['_dirty'] = True
        return False
    sig = '\n'.join(problems)
    if seen.get(key) == sig:
        return True
    text = ('The bot did not post this issue %s, because the post breaks '
            'these rules (%s):\n\n%s'
            '\n\nFix the comment and the bot tries again on its next pass.'
            % (POST_PLACES.get(channel, 'in #' + channel),
               'bot/README.md, "The site\'s known issues and roadmap"'
               if channel == 'roadmap'
               else 'docs/guide/the-board.md, "Test tasks and known issues"',
               '\n'.join('- ' + p for p in problems)))
    try:
        (say or github_say)(num, text)
    except Exception as e:
        log('refused %s post for #%s, and could not comment: %s' % (channel, num, e))
    seen[key] = sig
    state['_dirty'] = True
    return True


def fix_in_main(prs, commits, get=None):
    """True when a fix commit of the issue (a merged pull request's merge
       commit, or a commit naming it) is in the newest release/main tag,
       False when none is, None when that cannot be read."""
    get = get or _github_get
    try:
        refs = get('%s/repos/%s/git/matching-refs/tags/release/main/'
                   % (GITHUB_API, KNOWN_REPO)) or []
        tags = sorted(str(r.get('ref') or '') for r in refs if isinstance(r, dict))
        if not tags:
            return None
        tag = tags[-1][len('refs/tags/'):]
        shas = list(commits or [])
        for pr in prs or []:
            if pr.get('merged_at'):
                got = get('%s/repos/%s/pulls/%d' % (GITHUB_API, KNOWN_REPO, pr['number']))
                if got and got.get('merge_commit_sha'):
                    shas.append(got['merge_commit_sha'])
        for sha in shas:
            cmp = get('%s/repos/%s/compare/%s...%s' % (GITHUB_API, KNOWN_REPO, tag, sha))
            if str((cmp or {}).get('status')) in ('identical', 'behind'):
                return True
        return False
    except Exception:
        return None


def known_of(issue, comments):
    """(title, body, tags) for the #known-issues post: the last "Known
       issue:" comment, or the issue's title and a plain line until somebody
       writes one."""
    got = _marked(issue, comments, KNOWN_MARK)
    if got:
        return got[0], strip_footer(got[1]) or known_body(issue), issue_tags(issue, got[2])
    return known_title(issue), known_body(issue), issue_tags(issue)


def _sig(title, body, tags):
    return '%s\n%s\n%s' % (title, body, ','.join(sorted(tags)))


def default_task_body(issue):
    """The body for a fixed finding nobody wrote a test task for. Its issue
       closed when the fix reached main, so that is where to check it."""
    return ('This was fixed and the fix is on main. Check it on main, and say '
            'in #%s if it still happens.' % FINDINGS_NAME)


def task_post_of(issue, comments, dev_since=None):
    """(title, body, tags) for an issue's #test-tasks post, from its Main
       test task, or None when it gets none: not a finding and nobody wrote a
       test task, or its only test tasks say Server: Dev, which are
       #dev-test-tasks'."""
    task = main_task_of(issue, comments, dev_since)
    if task is not None:
        return task[0], strip_footer(task[1]) or 'Check this on main.', [TASK_TAG]
    if last_task(issue, comments, dev_since) is not None:
        return None
    if issue_tags_found(issue):
        return known_title(issue), default_task_body(issue), [TASK_TAG]
    return None


async def _forum_thread(forum, tid):
    """The thread by id, or None when it is gone."""
    guild = getattr(forum, 'guild', None)
    th = None
    getter = getattr(guild, 'get_thread', None)
    if getter is not None:
        th = getter(int(tid))
    if th is None and guild is not None:
        try:
            th = await guild.fetch_channel(int(tid))
        except discord.NotFound:
            return None
    return th


async def _bot_threads(forum, me_id=None):
    """Every post of the bot's in the forum, open and closed, oldest first.
       forum.threads holds only the open ones: a post staff closed, or one
       Discord closed after a few quiet days, is only in the archive."""
    mine = {}
    for th in list(getattr(forum, 'threads', None) or []):
        if me_id is None or getattr(th, 'owner_id', me_id) == me_id:
            mine[th.id] = th
    archived = getattr(forum, 'archived_threads', None)
    if archived is not None:
        async for th in archived(limit=None):
            if me_id is None or getattr(th, 'owner_id', me_id) == me_id:
                mine.setdefault(th.id, th)
    return [mine[k] for k in sorted(mine)]


async def _forum_post(forum, title, body, tags, me_id=None):
    """A post in the forum, tagged; a post of the bot's with that exact title,
       open or closed, is handed back rather than made twice. Returns the
       thread. Closed ones count since 22 Oct: Patrick found duplicates, and
       a post closed by staff or by Discord after quiet days was not looked
       at, so one whose record was lost was made again."""
    for th in await _bot_threads(forum, me_id):
        if str(getattr(th, 'name', '')) == title:
            return th
    applied = [t for t in (task_tag_of(forum, x) for x in tags) if t is not None]
    made = await forum.create_thread(name=title, content=body,
                                     applied_tags=applied,
                                     allowed_mentions=discord.AllowedMentions.none(),
                                     reason='Thornswood known issues and test tasks')
    return getattr(made, 'thread', made)


async def _forum_drop(forum, tid):
    th = await _forum_thread(forum, tid)
    if th is not None:
        await th.delete()


async def _forum_edit(forum, tid, title, body, tags):
    """Brings an existing post to this title, body and tags. False when the
       post is gone (deleted by hand), so the caller can make it again."""
    th = await _forum_thread(forum, tid)
    if th is None:
        return False
    applied = [x for x in (task_tag_of(forum, n) for n in tags) if x is not None]
    await th.edit(name=title, applied_tags=applied)
    msg = getattr(th, 'starter_message', None)
    if msg is None:
        try:
            msg = await th.fetch_message(th.id)
        except discord.NotFound:
            msg = None
    if msg is not None:
        await msg.edit(content=body, allowed_mentions=discord.AllowedMentions.none())
    return True


async def _thread_more(th, me_id):
    """The bot's own messages in a thread after its first post, oldest
       first, by id: the follow-ups of a long dev post."""
    out = []
    async for m in th.history(limit=100, oldest_first=True):
        if (getattr(m, 'id', None) != getattr(th, 'id', None)
                and (me_id is None or getattr(getattr(m, 'author', None), 'id', None) == me_id)):
            out.append(m.id)
    return out


async def _sync_more(th, texts, more):
    """
    Brings the follow-up messages of a post to texts, in order, and returns
    their ids. Each one still there is edited; from the first one that is
    gone (deleted by hand), every later one is deleted and the rest sent
    again, so the thread always reads in order. Extra old ones are deleted.
    """
    none = discord.AllowedMentions.none()
    ids, keep = [], list(more or [])
    i = 0
    while i < len(texts) and i < len(keep):
        try:
            msg = await th.fetch_message(int(keep[i]))
        except discord.NotFound:
            break
        await msg.edit(content=texts[i], allowed_mentions=none)
        ids.append(msg.id)
        i += 1
    for mid in keep[i:]:
        try:
            msg = await th.fetch_message(int(mid))
        except discord.NotFound:
            continue            # already gone, which is what is wanted
        await msg.delete()
    for text in texts[i:]:
        sent = await th.send(text, allowed_mentions=none)
        ids.append(sent.id)
    return ids


async def _dev_post(forum, title, chunks, tags, me_id=None):
    """A #dev-test-tasks post over as many messages as its text takes.
       (thread, follow-up ids). A post of the bot's with this title, open or
       closed, made before a crash or whose record was lost, is taken up with
       what it already holds, never made twice."""
    found = None
    for th in await _bot_threads(forum, me_id):
        if str(getattr(th, 'name', '')) == title:
            found = th
            break
    if found is None:
        th = await _forum_post(forum, title, chunks[0], tags, me_id)
        more = []
    else:
        th = found
        await _forum_edit(forum, th.id, title, chunks[0], tags)
        more = await _thread_more(th, me_id)
    return th, await _sync_more(th, chunks[1:], more)


async def known_issues_once(forum, state, get=None, save=None, me_id=None, say=None):
    """
    One pass over #known-issues, a forum. state is the dict kept in
    known-issues.json, changed in place; the caller writes it. Returns the
    issue numbers posted, edited and removed.

    A known issue is a finding people still meet: an open issue labelled
    Dev Findings or Main Findings whose fix has not landed (Patrick, 22 Oct,
    and #3140). Its fix has landed when the issue gets a "Test task:"
    comment or is in Done: done-on-merge.yml's comment on it (merged_fix),
    A card is never moved to Done by hand (#5185): it follows that same
    merged test task. A closed or unlabelled issue is not a finding at all. Then its post goes: the fix is a test task, not
    a known issue. A merged pull request alone does not take it down: until
    26 Oct any one that named the issue did, and a measuring step on the
    scripts finding, a partial fix, and a Refs written by mistake each kept
    a bug people still meet off the list (#3140).
    An issue the label lists leave out is read itself first, and its post
    stays unless that read says it is closed, unlabelled, moved or deleted
    (finding_gone, #3438).

    Comments are read only for an issue GitHub says changed since the last
    pass (its updated_at), or whose record was made with an older form of
    the post (KNOWN_FORM), so an untouched issue costs nothing. A label put
    on or a comment written moves updated_at, so nothing else is read. That
    holds for an issue that ends with no post as well (a test task, a merged
    fix, a post that breaks a rule): state['known_read'] keeps the updated_at
    it was read at. Until 1 Nov only a posted issue was remembered, so every
    pass read the comments of every other one again (#5184).
    """
    loop = asyncio.get_running_loop()
    issues = await loop.run_in_executor(None, github_open_findings, get)
    rec = state.setdefault('issues', {})
    read = state.setdefault('known_read', {})
    for key in [k for k in read if int(k) not in issues]:
        read.pop(key, None)
        state['_dirty'] = True

    def unposted(key, mark):
        # Read at this update time and left with no post (mark), or with the
        # post already up kept as it was (mark + '|kept').
        if read.get(key) != mark:
            read[key] = mark
            state['_dirty'] = True
    # Records from before #known-issues was a forum point at messages in a
    # channel that is gone: they are forgotten, not deleted again.
    for key, have in list(rec.items()):
        if have.get('channel_id') != getattr(forum, 'id', None) or 'thread_id' not in have:
            rec.pop(key, None)
            state['_dirty'] = True
    if state.pop('known_changed', None) is not None:
        state['_dirty'] = True      # the merged pull requests the old rule kept
    posted, edited, removed, listed = [], [], [], set()
    # Why each issue that is not listed is not, said when its post comes
    # down. Ten posts came down and went back up as a set several times
    # before 26 Oct with no line saying why (#3140).
    why = {}
    for num in sorted(issues):
        key = str(num)
        issue = issues[num]
        have = rec.get(key)
        if (have and have.get('updated') == issue.get('updated_at')
                and have.get('form') == KNOWN_FORM):
            listed.add(num)
            continue
        mark = '%s|%s' % (issue.get('updated_at'), KNOWN_FORM)
        if have and read.get(key) == mark + '|kept':
            listed.add(num)         # its post breaks a rule: the one up stays
            continue
        if not have and read.get(key) == mark:
            continue                # read at this update time: no post
        comments = await loop.run_in_executor(None, github_comments, num, get)
        if _all_marked(issue, comments, TASK_MARK, room=None):
            why[key] = 'it has a "Test task:" comment'
            unposted(key, mark)
            continue                # it has a test task: being checked, not known
        if merged_fix(comments):
            why[key] = 'done-on-merge wrote its merged fix on it'
            unposted(key, mark)
            continue                # fixed, waiting on main: not a known issue
        title, body, tags = known_of(issue, comments)
        taken = [v.get('sig', '').split('\n')[0] for k, v in rec.items() if k != key]
        if refuse(state, 'known', num, post_problems(
                'known', title, body, issue=issue,
                has_task=False, taken_titles=taken), say):
            if have:
                listed.add(num)     # the post already up stays as it was
            why[key] = 'its post breaks a rule'
            unposted(key, mark + ('|kept' if have else ''))
            continue
        listed.add(num)
        if read.pop(key, None) is not None:
            state['_dirty'] = True
        sig = _sig(title, body, tags)
        if have:
            if have.get('sig') != sig:
                try:
                    if not await _forum_edit(forum, have['thread_id'], title, body, tags):
                        have = None
                        rec.pop(key, None)
                    else:
                        edited.append(num)
                except discord.HTTPException:
                    continue
            if have:
                have.update(sig=sig, updated=issue.get('updated_at'),
                            form=KNOWN_FORM)
                state['_dirty'] = True
                continue
        th = await _forum_post(forum, title, body, tags, me_id)
        rec[key] = {'thread_id': th.id, 'channel_id': forum.id, 'sig': sig,
                    'updated': issue.get('updated_at'), 'form': KNOWN_FORM}
        state['_dirty'] = True
        if save:
            save(state)      # straight away, so a crash cannot double it
        posted.append(num)
    # An issue the label lists left out is read itself before its post comes
    # down (finding_gone). Every read is made before anything is taken down,
    # so a read that fails fails the pass with every post still up.
    for key in list(rec):
        if int(key) in listed or int(key) in issues:
            continue                # listed, or not for a reason found above
        gone = await loop.run_in_executor(None, finding_gone, int(key), get)
        if gone is None:
            log('known issues: the open findings GitHub listed left out #%s, '
                'which is still open and labelled; its post stays' % key)
            listed.add(int(key))
        else:
            why[key] = gone
    for key, have in list(rec.items()):
        if int(key) in listed:
            continue
        try:
            await _forum_drop(forum, have['thread_id'])
        except discord.HTTPException:
            continue
        rec.pop(key, None)
        state['_dirty'] = True
        removed.append(int(key))
        log('known issues: took #%s down: %s'
            % (key, why.get(key, 'no reason was recorded')))
    return posted, edited, removed


async def test_tasks_once(forum, state, get=None, save=None, me_id=None, now=None,
                         say=None):
    """
    One pass over #test-tasks. An issue closed as fixed gets a post when it
    was closed after state['since'] (set to now on the first pass, so nothing
    from before this began floods in), or when its latest "Test task:"
    comment was written after since. Every post is tagged Main (TASK_TAG).
    A rewritten comment edits the post, and so does a record made with an
    older form of the post (TASK_FORM), once; an issue that is reopened
    loses it. An issue whose last test task says Server: Dev, from the day
    #dev-test-tasks began (state['dev_since']), gets no post here: it is
    in #dev-test-tasks. Returns the issue numbers posted, edited and removed.
    """
    loop = asyncio.get_running_loop()
    dev_since = state.get('dev_since')
    since = state.get('since')
    if not since:
        state['since'] = since = now or _utc_stamp()
        state['_dirty'] = True
    rec = state.setdefault('tasks', {})

    async def broken(num, issue, comments, post):
        # The rules check before a #test-tasks post goes up or is edited.
        task = main_task_of(issue, comments, dev_since)
        if task is None:
            return False    # the bot's own line for a fixed finding
        timeline = await loop.run_in_executor(None, github_timeline, num, get)
        refs = await loop.run_in_executor(None, fix_refs, timeline, get)
        inmain = await loop.run_in_executor(None, fix_in_main, *refs, get)
        taken = [v.get('sig', '').split('\n')[0] for k, v in rec.items()
                 if k != str(num)]
        return refuse(state, 'main', num, post_problems(
            'main', post[0], post[1],
            server=task_server_line(issue, comments, task[4]),
            fix_in_main=inmain, taken_titles=taken), say)

    closed = await loop.run_in_executor(None, github_closed_since, since, get)
    # Each closed issue read at its update time and left with no post (or
    # with the post up kept as it was, '|kept'), so it is read again only
    # once it changes. Until 1 Nov only a posted issue was remembered, and
    # every pass read the comments of every other issue closed since 'since'
    # again: about 1,200 calls a pass, the whole hourly allowance in four
    # passes (#5184).
    read = state.setdefault('tasks_read', {})
    for key in [k for k in read if int(k) not in closed]:
        read.pop(key, None)
        state['_dirty'] = True

    def unposted(key, mark):
        if read.get(key) != mark:
            read[key] = mark
            state['_dirty'] = True

    posted, edited, removed = [], [], []
    for num in sorted(closed):
        key = str(num)
        issue = closed[num]
        have = rec.get(key)
        if (issue.get('state_reason') or 'completed') != 'completed':
            continue
        if (have and have.get('updated') == issue.get('updated_at')
                and have.get('form') == TASK_FORM):
            continue
        mark = '%s|%s' % (issue.get('updated_at'), TASK_FORM)
        if read.get(key) == (mark + '|kept' if have else mark):
            continue                # read at this update time: nothing to do
        comments = await loop.run_in_executor(None, github_comments, num, get)
        task = test_task_of(issue, comments, dev_since)
        new_enough = (str(issue.get('closed_at') or '') >= since
                      or (task is not None and task[2] >= since))
        if not have and not new_enough:
            unposted(key, mark)
            continue
        post = task_post_of(issue, comments, dev_since)
        if post is None:
            # Not a finding and no Main test task: none was written, or the
            # one there was taken back (its comment no longer starts "Test
            # task:"), or it is a Dev one, which is #dev-test-tasks'. A post
            # already here goes: it is no longer a test task for testers.
            if have:
                try:
                    await _forum_drop(forum, have['thread_id'])
                except discord.HTTPException:
                    continue
                rec.pop(key, None)
                state['_dirty'] = True
                removed.append(num)
            unposted(key, mark)
            continue
        title, body, tags = post
        sig = _sig(title, body, tags)
        if (not have or have.get('sig') != sig) and await broken(num, issue, comments, post):
            unposted(key, mark + ('|kept' if have else ''))
            continue        # not posted, and a post already up keeps its text
        if read.pop(key, None) is not None:
            state['_dirty'] = True
        if have:
            if have.get('sig') != sig:
                try:
                    if await _forum_edit(forum, have['thread_id'], title, body, tags):
                        edited.append(num)
                    else:
                        rec.pop(key, None)     # deleted by hand: confirmed
                        state['_dirty'] = True
                        continue
                except discord.HTTPException:
                    continue
            have.update(sig=sig, updated=issue.get('updated_at'), form=TASK_FORM)
            state['_dirty'] = True
            continue
        th = await _forum_post(forum, title, body, tags, me_id)
        rec[key] = {'thread_id': th.id, 'channel_id': forum.id, 'sig': sig,
                    'updated': issue.get('updated_at'), 'form': TASK_FORM}
        state['_dirty'] = True
        if save:
            save(state)
        posted.append(num)
    for key, have in list(rec.items()):
        if int(key) in closed:
            continue
        try:
            issue = await loop.run_in_executor(None, github_issue, int(key), get)
        except Exception:
            continue
        if str(issue.get('state')) == 'open':
            try:
                await _forum_drop(forum, have['thread_id'])
            except discord.HTTPException:
                continue
            rec.pop(key, None)
            state['_dirty'] = True
            removed.append(int(key))
        elif (have.get('updated') != issue.get('updated_at')
                or have.get('form') != TASK_FORM):
            # Closed before since, and changed since the last pass (an adopted
            # post whose comment was rewritten) or made with an older form of
            # the post: brought up to date.
            comments = await loop.run_in_executor(None, github_comments, int(key), get)
            post = task_post_of(issue, comments, dev_since)
            if post is None:
                # Its test task was taken back: the post goes, as above.
                try:
                    await _forum_drop(forum, have['thread_id'])
                except discord.HTTPException:
                    continue
                rec.pop(key, None)
                state['_dirty'] = True
                removed.append(int(key))
                continue
            sig = _sig(*post)
            if have.get('sig') != sig and await broken(int(key), issue, comments, post):
                continue
            if have.get('sig') != sig:
                try:
                    if await _forum_edit(forum, have['thread_id'], *post):
                        edited.append(int(key))
                except discord.HTTPException:
                    continue
            have['sig'] = sig
            have['updated'] = issue.get('updated_at')
            have['form'] = TASK_FORM
            state['_dirty'] = True
    return posted, edited, removed


async def dev_tasks_once(forum, state, get=None, save=None, me_id=None, now=None,
                        say=None):
    """
    One pass over #dev-test-tasks, found by the id the setup recorded. An
    issue, open or closed, with a "Test task:" comment saying Server: Dev
    gets a post tagged Dev from its last one (dev_task_of), written for
    developers (dev_render: the issue, its pull requests and commits,
    labels, build, and the whole test task, over as many messages as it
    takes); it goes when that comment is taken back, and stays beside a
    Main one. A rewritten comment, or any other change to the issue that
    changes the post, edits it.

    The first pass sets state['dev_since'] to now: nothing written before it
    counts as a dev test task, so nothing from before floods in and no post
    already in #test-tasks moves. Each pass reads only the issues GitHub says
    changed since the last (state['dev_seen'], GitHub's own update time of
    the last issue read), so an untouched issue costs nothing. An issue
    Discord refused is read again on the next pass.
    Returns the issue numbers posted, edited and removed.
    """
    loop = asyncio.get_running_loop()
    since = state.get('dev_since')
    if not since:
        state['dev_since'] = since = now or _utc_stamp()
        state['_dirty'] = True
    mark = state.get('dev_seen') or since
    rec = state.setdefault('dev', {})
    read = state.setdefault('dev_read', {})
    changed = await loop.run_in_executor(None, github_changed_since, mark, get)
    posted, edited, removed, refused = [], [], [], []
    newest = mark
    for num in sorted(changed):
        key = str(num)
        issue = changed[num]
        upd = str(issue.get('updated_at') or '')
        newest = max(newest, upd)
        have = rec.get(key)
        if read.get(key) == upd and (not have or have.get('form') == DEV_FORM):
            continue            # read at this update time on an earlier pass
        comments = await loop.run_in_executor(None, github_comments, num, get)
        task = dev_task_of(issue, comments, since)
        post = None
        if task is not None:
            taken = [v.get('sig', '').split('\n')[0] for k, v in rec.items() if k != key]
            if refuse(state, 'dev', num, post_problems(
                    'dev', task[0], task[1], server=task[2],
                    taken_titles=taken), say):
                read[key] = upd     # the post already up, if any, keeps its text
                state['_dirty'] = True
                continue
            timeline = await loop.run_in_executor(None, github_timeline, num, get)
            refs = await loop.run_in_executor(None, fix_refs, timeline, get)
            post = dev_render(issue, task, *refs)
        try:
            if post is None:
                if have:
                    await _forum_drop(forum, have['thread_id'])
                    rec.pop(key, None)
                    removed.append(num)
            else:
                title, body, tags = post
                sig = _sig(title, body, tags)
                chunks = dev_chunks(body)
                if have and have.get('sig') != sig:
                    if await _forum_edit(forum, have['thread_id'], title, chunks[0], tags):
                        th = await _forum_thread(forum, have['thread_id'])
                        have['more'] = await _sync_more(th, chunks[1:],
                                                        have.get('more') or [])
                        edited.append(num)
                    else:
                        rec.pop(key, None)     # deleted by hand: made again
                        have = None
                if have:
                    have.update(sig=sig, updated=upd, form=DEV_FORM)
                else:
                    th, more = await _dev_post(forum, title, chunks, tags, me_id)
                    rec[key] = {'thread_id': th.id, 'channel_id': forum.id,
                                'more': more, 'sig': sig, 'updated': upd,
                                'form': DEV_FORM}
                    if save:
                        save(state)    # straight away, so a crash cannot double it
                    posted.append(num)
        except discord.HTTPException:
            refused.append(upd)
            continue
        read[key] = upd
        state['_dirty'] = True
    # GitHub's since is inclusive, so the next pass starts at the newest
    # update read, or at the oldest one Discord refused, to try it again.
    mark = min([newest] + refused)
    if state.get('dev_seen') != mark:
        state['dev_seen'] = mark
        state['_dirty'] = True
    for key in [k for k, v in read.items() if v < mark]:
        read.pop(key, None)
        state['_dirty'] = True
    return posted, edited, removed


async def forum_check(forum, records, me_id=None, apply=False):
    """
    The duplicates in one of the three forums, and with apply, gone. records
    maps a thread id to the issue whose post it is (known-issues.json). Two
    posts of the bot's with the same title are one too many: the one an issue
    owns is kept, or the oldest when none is, and the rest are deleted. Two
    posts that two issues own under one title are said and left: both issues
    carry the same test task, which is fixed on the issues. Returns the lines
    it says.
    """
    lines, by_title = [], {}
    threads = await _bot_threads(forum, me_id)
    for th in threads:
        by_title.setdefault(str(getattr(th, 'name', '')), []).append(th)
    owned = [th for th in threads if th.id in records]
    lines.append('#%s: %d post(s) of the bot\'s, %d owned by an issue'
                 % (getattr(forum, 'name', '?'), len(threads), len(owned)))
    gone = 0
    for title in sorted(by_title):
        group = by_title[title]
        if len(group) < 2:
            continue
        mine = [th for th in group if th.id in records]
        keep = mine or group[:1]
        extra = [th for th in group if th not in keep]
        lines.append('  "%s": %d posts; keeps %s%s' % (
            title, len(group),
            ', '.join('%d (#%s)' % (th.id, records.get(th.id, '-')) for th in keep),
            '; two issues own this title, fix it on the issues' if len(mine) > 1 else ''))
        for th in extra:
            if apply:
                await th.delete()
                gone += 1
                lines.append('    deleted %d' % th.id)
            else:
                lines.append('    would delete %d' % th.id)
    if apply:
        lines.append('  %d deleted' % gone)
    return lines


def forum_records(state):
    """{thread id: issue number} for each of the three forums' records."""
    def of(part):
        return dict((int(v['thread_id']), int(k)) for k, v in
                    (state.get(part) or {}).items()
                    if isinstance(v, dict) and v.get('thread_id'))
    return {'known': of('issues'), 'tasks': of('tasks'), 'dev': of('dev')}


def adopt_task(number, thread_id, path=None):
    """Records a test task post made by hand (--post-task) as issue number's,
       so later passes edit it and take it down if the issue reopens. Run
       with the bot stopped: the running bot holds the file in memory."""
    path = path or KNOWN_STATE
    state = _state_read(path)
    if state is None:
        raise RuntimeError('%s will not read; nothing was changed' % path)
    state.setdefault('tasks', {})[str(int(number))] = {
        'thread_id': int(thread_id), 'channel_id': None, 'sig': '', 'updated': ''}
    _state_write(path, state)
    return 'issue %d now owns test task post %d' % (int(number), int(thread_id))


# -------------------------------------- the site's known issues and roadmap --
#
# Issue #3140 (Patrick): the site's Known Issues page and its roadmap are built
# from the board, so they cannot go stale. Until then both were boards typed
# into site/data/board.json; the roadmap's Later lane said the emote wheel was
# never started while it shipped (test-roadmap.js), and the known board kept
# NPC behaviour that #504 had fixed. The bot already reads the board for the
# Discord forums, with the one issues token there is, so it writes both lists
# into one file the site reads:
#
#   known    the posts that are up in #known-issues, the same list, each as
#            its title, its words and where it was found (Main, Dev). One
#            rule decides both: known_issues_once.
#   roadmap  every open issue labelled "roadmap: now", "roadmap: next" or
#            "roadmap: later", in that lane. A closed one is off the
#            roadmap: it has no Done lane (Patrick, 26 Oct).
#            Its words are its last "Roadmap:" comment: the first line is
#            what is being built (45 characters at most), the lines under it
#            where it stands. The rules of a known issue hold for it (no
#            footer, no issue number, link or code), and so do the writing
#            rules of a public page (no em dash, never "player"). An issue
#            with a lane and no such comment, or one that breaks a rule, is
#            left off and gets one comment saying why (refuse).
#
# The file is PUBLIC_LISTS_FILE, in the site's data\from-bot folder, which
# holds only what the bot writes for the site: the site makes it, and
# Install-Bot.ps1 gives the bot's account Modify on it and nothing else of the
# site's (the other way round from for-bot, #1102). It is written whole after
# every pass, with the time of the pass, so the site can say how old it is;
# a part the bot could not read this pass is left out rather than written
# empty, and the site says that part could not be read.
PUBLIC_LISTS_FILE = os.environ.get(
    'PUBLIC_LISTS_FILE', r'C:\Thornswood-Docs\data\from-bot\lists.json')
ROADMAP_LANES = (('now', 'Being built now'), ('next', 'Next'), ('later', 'Later'))
ROADMAP_MARK = re.compile(r'^\s*roadmap\s*:\s*(.*)$', re.I)


def roadmap_label(lane):
    return 'roadmap: %s' % lane


def github_labelled(label, state, get=None):
    """Every issue (not pull request) with the label, open or closed (state),
       by number."""
    get = get or _github_get
    out = {}
    page = 1
    while True:
        url = ('%s/repos/%s/issues?state=%s&per_page=100&page=%d&labels=%s'
               % (GITHUB_API, KNOWN_REPO, state, page, urllib.parse.quote(label)))
        rows = get(url) or []
        for row in rows:
            if isinstance(row, dict) and 'pull_request' not in row:
                out.setdefault(int(row['number']), row)
        if len(rows) < 100:
            break
        page += 1
    return out


def roadmap_lanes_of(issue):
    """The lanes (now, next, later) the issue is labelled with."""
    names = [n.lower() for n in _labels(issue)]
    return [lane for lane, _name in ROADMAP_LANES if roadmap_label(lane) in names]


def roadmap_of(issue, comments):
    """(title, words, problems) for the issue's roadmap row, from its last
       "Roadmap:" comment. problems is empty when it may go on the site."""
    got = _marked(issue, comments, ROADMAP_MARK, room=None)
    if got is None:
        return None, None, ['Roadmap: the issue has a roadmap label and no '
                            'comment whose first line starts "Roadmap:", '
                            'which holds the words the site shows.']
    title, body = got[0], strip_footer(got[1])
    return title, body, post_problems('roadmap', title, body)


def roadmap_once(state, get=None, say=None):
    """
    One read of the roadmap off the board. state is the dict kept in
    known-issues.json, changed in place; its 'roadmap' part remembers each
    labelled issue's row by its updated_at, so comments are read only for an
    issue that changed (a label, a close and a comment all move it). Returns
    the roadmap as the site draws it: {lanes: [{name, rows: [{title, text}]}]},
    the lanes in order, each by issue number. Only open issues are read: the
    roadmap has no Done lane (Patrick, 26 Oct, "Done section needs removed
    from the roadmap"), so an issue that closes leaves it.
    """
    seen = {}
    for lane, _name in ROADMAP_LANES:
        for num, issue in github_labelled(roadmap_label(lane), 'open', get).items():
            seen[num] = issue
    rec = state.setdefault('roadmap', {})
    for key in [k for k in rec if int(k) not in seen]:
        rec.pop(key, None)
        state['_dirty'] = True
    rows = dict((name, []) for _lane, name in ROADMAP_LANES)
    for num in sorted(seen):
        issue = seen[num]
        key = str(num)
        have = rec.get(key)
        if not have or have.get('updated') != issue.get('updated_at'):
            title, body, problems = roadmap_of(issue, github_comments(num, get))
            lanes = roadmap_lanes_of(issue)
            if len(lanes) > 1:
                problems = problems + ['Roadmap: the issue is in %s at once; '
                                       'one lane only.' % ', '.join(
                                           roadmap_label(l) for l in lanes)]
            have = rec[key] = {'updated': issue.get('updated_at'),
                               'title': title, 'text': body,
                               'problems': problems}
            state['_dirty'] = True
        if refuse(state, 'roadmap', num, have.get('problems') or [], say):
            continue
        rows[dict(ROADMAP_LANES)[roadmap_lanes_of(issue)[0]]].append(
            {'title': have['title'], 'text': have['text']})
    return {'lanes': [{'name': name, 'rows': rows[name]}
                      for _lane, name in ROADMAP_LANES]}


def known_list(state):
    """The posts up in #known-issues, as the site shows them: title, words
       and where (Main, Dev), by issue number. The records hold each post's
       sig, which is exactly what went up (_sig)."""
    out = []
    for key in sorted((state.get('issues') or {}), key=int):
        sig = str((state['issues'][key] or {}).get('sig') or '')
        if not sig:
            continue
        title, rest = (sig.split('\n', 1) + [''])[:2]
        body, _, tags = rest.rpartition('\n')
        out.append({'title': title, 'text': body,
                    'where': [t for t in tags.split(',') if t]})
    return out


def write_public_lists(known, roadmap, path=None, now=None):
    """Writes the site's lists: known and roadmap as the passes made them,
       either None when it could not be read this pass, and so left out."""
    data = {'at': now or _utc_stamp()}
    if known is not None:
        data['known'] = known
    if roadmap is not None:
        data['roadmap'] = roadmap
    _state_write(path or PUBLIC_LISTS_FILE, data)
    return data


def issue_tags_found(issue):
    names = _labels(issue)
    return any(l in names for l in KNOWN_LABELS)


def _known_save(state, path=None):
    clean = dict((k, v) for k, v in state.items() if not k.startswith('_'))
    _state_write(path or KNOWN_STATE, clean)
    state.pop('_dirty', None)


async def watch_known_issues():
    await client.wait_until_ready()
    if not github_token():
        log('known issues: no GitHub token (GITHUB_TOKEN_FILE or GITHUB_TOKEN), so #%s, #%s and '
            '#%s are not kept' % (KNOWN_NAME, TASKS_NAME, DEV_TASKS_NAME))
        return
    state = _state_read(KNOWN_STATE)
    if state is None:
        log('known issues: %s will not read, so nothing is posted until it is '
            'fixed by hand (posting from empty would double every post)'
            % KNOWN_STATE)
        return
    said_text = said_dev = said_lists = False
    while not client.is_closed():
        try:
            known = tasks = dev = None
            for g in client.guilds:
                known = known or _channel_named(g, KNOWN_NAME, ('forum',))
                tasks = tasks or _channel_named(g, TASKS_NAME, ('forum',))
                # By the id the one-time setup recorded, read each pass so a
                # setup run while the bot is up is picked up without a restart.
                dev = dev or dev_tasks_forum(g)
                if (dev is None and not said_dev
                        and _setup_rec(g).get('dev_tasks_id')):
                    log('known issues: the #%s recorded in %s (id %s) is not on '
                        'the server, so dev test tasks are not posted. The '
                        'one-time step (python bot.py --setup-channels --apply) '
                        'makes it again.' % (DEV_TASKS_NAME, SETUP_STATE,
                                             _setup_rec(g).get('dev_tasks_id')))
                    said_dev = True
                if known is None and not said_text and _channel_named(g, KNOWN_NAME, ('text',)):
                    log('known issues: #%s is still a text channel. The one-time '
                        'step (python bot.py --setup-channels --apply) makes it '
                        'a forum.' % KNOWN_NAME)
                    said_text = True
            me = getattr(client.user, 'id', None)
            if known is not None:
                posted, edited, removed = await known_issues_once(
                    known, state, save=_known_save, me_id=me)
                if posted or edited or removed:
                    log('known issues: posted %s, edited %s, removed %s'
                        % (posted or 'none', edited or 'none', removed or 'none'))
            if tasks is not None:
                posted, edited, removed = await test_tasks_once(
                    tasks, state, save=_known_save, me_id=me)
                if posted or edited or removed:
                    log('test tasks: posted %s, edited %s, removed %s'
                        % (posted or 'none', edited or 'none', removed or 'none'))
            if dev is not None:
                posted, edited, removed = await dev_tasks_once(
                    dev, state, save=_known_save, me_id=me)
                if posted or edited or removed:
                    log('dev test tasks: posted %s, edited %s, removed %s'
                        % (posted or 'none', edited or 'none', removed or 'none'))
            # The site's lists (#3140): known only when #known-issues was
            # kept this pass, since it is that forum's list.
            roadmap = await asyncio.get_running_loop().run_in_executor(
                None, roadmap_once, state)
            if state.get('_dirty'):
                _known_save(state)
            try:
                write_public_lists(known_list(state) if known is not None else None,
                                   roadmap)
            except OSError as e:
                if not said_lists:
                    log('known issues: could not write the site\'s lists to %s '
                        '(%s). Install-Bot.ps1 gives the bot Modify on that '
                        'folder once Deploy-Docs.ps1 has made it.'
                        % (PUBLIC_LISTS_FILE, type(e).__name__))
                    said_lists = True
            else:
                said_lists = False
        except Exception as e:
            log('known issues: a pass failed: %s' % pass_failure(e))
            # What it read before it failed is kept, so the next pass does
            # not read it again, after a restart as well (#5184).
            if state.get('_dirty'):
                try:
                    _known_save(state)
                except OSError as e2:
                    log('known issues: could not save %s after the failed '
                        'pass (%s)' % (KNOWN_STATE, type(e2).__name__))
        await asyncio.sleep(KNOWN_EVERY)


# ------------------------------------------------ staff notices from issues --
#
# A staff notice can be an issue on the board labelled "notice: staff" (#5187):
# its body is the notice. Each pass reads the open ones, says each in
# #staff-updates through watch_send, the way the watchdog's outbox is said,
# writes down the Discord message it became in staff-notices.json, and only
# then comments on the issue and closes it. So a failed comment or close is
# tried again next pass, and the notice is never said twice. A cloud thread
# files one with Say-Staff.ps1, which needs no ssh, no runner and no key on
# the box.
#
# Who may: GitHub lets only people with triage or more put a label on, and no
# issue form here puts this one on. The bot also holds the issue's author to
# the team (OWNER, MEMBER, COLLABORATOR) or one of the Apps installed on the
# repository, so a team member labelling somebody else's issue does not say
# it in the staff channel. The same limits as say-staff.ps1 on the box: 1800
# characters, 30 an hour for each sender, mentions off; and like the
# watchdog's outbox, a notice that waited a day is not said.
#
# Taking one back: the label "notice: take back" on its issue. The bot
# deletes the message, or withholds a notice not said yet, comments what it
# did once, and writes it down.
#
# Both lists are asked with the ETag of the last answer, so a pass where
# nothing changed is answered 304, which GitHub does not count against the
# bot's hourly limit (the bot's rereads used up the shared quota, #5260).
STAFF_NOTICE_LABEL = os.environ.get('STAFF_NOTICE_LABEL', 'notice: staff').strip()
STAFF_TAKE_BACK_LABEL = os.environ.get('STAFF_TAKE_BACK_LABEL', 'notice: take back').strip()
STAFF_NOTICES = os.path.join(DATA_DIR, 'staff-notices.json')
NOTICE_EVERY = max(30, _int_env('STAFF_NOTICE_EVERY', 60))
NOTICE_MAX = 1800
NOTICE_PER_HOUR = 30
NOTICE_MAX_AGE = 24 * 3600
NOTICE_TEAM = ('OWNER', 'MEMBER', 'COLLABORATOR')
# Say-Staff.ps1's title, which names who the notice is from: its -From.
NOTICE_FROM = re.compile(r'^\s*staff notice from ([a-z][a-z0-9-]{0,30})\s*$', re.I)
# A said notice is remembered this long, for taking it back and the hourly limit.
NOTICE_KEEP = 30 * 24 * 3600


def _github_time(text):
    """A GitHub time (2026-11-01T19:12:00Z) in unix seconds, or None."""
    try:
        return datetime.datetime.strptime(str(text or ''), '%Y-%m-%dT%H:%M:%SZ').replace(
            tzinfo=datetime.timezone.utc).timestamp()
    except ValueError:
        return None


def _github_get_cached(url, cache, opener=None):
    """_github_get, asked with the ETag of the answer last kept in cache for
       url: a 304 gives that answer again. A failure raises, as there."""
    token = github_token()
    headers = {'Accept': 'application/vnd.github+json',
               'Authorization': 'Bearer ' + token,
               'User-Agent': 'thornswood-bot',
               'X-GitHub-Api-Version': '2022-11-28'}
    held = cache.get(url)
    if held:
        headers['If-None-Match'] = held[0]
    req = urllib.request.Request(url, headers=headers)
    try:
        with (opener or urllib.request.urlopen)(req, timeout=20) as r:
            got = json.loads(r.read().decode('utf-8'))
            etag = r.headers.get('ETag')
    except urllib.error.HTTPError as e:
        if e.code == 304 and held:
            return held[1]
        raise
    if etag:
        cache[url] = (etag, got)
    else:
        cache.pop(url, None)
    return got


def github_close(number, reason='completed'):
    """Closes the issue with reason (completed or not_planned)."""
    token = github_token()
    req = urllib.request.Request(
        '%s/repos/%s/issues/%d' % (GITHUB_API, known_repo_now(), int(number)),
        data=json.dumps({'state': 'closed', 'state_reason': reason}).encode('utf-8'),
        method='PATCH',
        headers={'Accept': 'application/vnd.github+json',
                 'Authorization': 'Bearer ' + token,
                 'User-Agent': 'thornswood-bot',
                 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode('utf-8'))


def notice_sender(issue):
    """Who the notice is from: the word Say-Staff.ps1's title names, else the
       author's login, lower case and without [bot]."""
    m = NOTICE_FROM.match(str(issue.get('title') or ''))
    if m:
        return m.group(1).lower()
    login = str((issue.get('user') or {}).get('login') or 'unknown').lower()
    return re.sub(r'\[bot\]$', '', login) or 'unknown'


def notice_of(issue, now):
    """(sender, text, problems) for the issue's notice. problems is empty when
       it may be said; each one is a sentence for the refusal comment."""
    sender = notice_sender(issue)
    text = strip_footer(str(issue.get('body') or '').replace('\r\n', '\n')).strip()
    problems = []
    user = issue.get('user') or {}
    if (str(issue.get('author_association') or '') not in NOTICE_TEAM
            and str(user.get('type') or '') != 'Bot'):
        problems.append('The issue was filed by %s, who is not on the team. A '
                        'notice is said only from an issue the team or one of '
                        "the repository's Apps filed."
                        % (user.get('login') or 'somebody unknown'))
    if not text:
        problems.append('The issue has no body, and the body is the notice.')
    elif len(text) > NOTICE_MAX:
        problems.append('The notice is %d characters and %d is the most. '
                        'Nothing was cut.' % (len(text), NOTICE_MAX))
    made = _github_time(issue.get('created_at'))
    if made is not None and now - made > NOTICE_MAX_AGE:
        problems.append('The issue was filed more than a day ago, and a notice '
                        'a day late is noise, not news.')
    return sender, text, problems


def notices_this_hour(state, sender, now):
    return sum(1 for r in (state.get('said') or {}).values()
               if isinstance(r, dict) and r.get('from') == sender
               and now - (r.get('at') or 0) < 3600)


async def staff_notices_once(state, notices, take_backs, send, delete,
                             comment, close, save, now=None):
    """
    One pass. notices are the open issues labelled STAFF_NOTICE_LABEL and
    take_backs every issue labelled STAFF_TAKE_BACK_LABEL, by number. send
    says a text in the staff channel and gives the message or None; delete
    takes a message id away and gives 'deleted' or 'gone'; comment and close
    (number, reason) write to GitHub and raise on failure. state is
    staff-notices.json's dict, changed in place and saved with save(state)
    after every message said, before anything else is done. Returns the
    numbers said, the numbers taken back and the numbers refused.
    """
    now = time.time() if now is None else now
    said = state.setdefault('said', {})
    refused = state.setdefault('refused', {})
    unsaid = state.setdefault('unsaid', {})
    out_said, out_back, out_refused = [], [], []

    def finish(num, rec):
        # Each step written down as it is done, so a failed one is the only
        # one tried again.
        if not rec.get('told'):
            comment(num, 'Said in #staff-updates. The label "%s" on this issue '
                    'takes it out again.' % STAFF_TAKE_BACK_LABEL)
            rec['told'] = True
            save(state)
        if not rec.get('closed'):
            close(num, 'completed')
            rec['closed'] = True
            save(state)

    for num in sorted(take_backs):
        key = str(num)
        if key in unsaid:
            continue
        rec = said.get(key)
        if rec:
            result = await delete(rec.get('message'))
            words = ('The notice is taken out of #staff-updates.' if result == 'deleted'
                     else 'The notice was already gone from #staff-updates.')
        elif num in notices:
            result = 'withheld'
            words = 'The notice was not said yet, and now it never is.'
        else:
            result = 'unknown'
            words = ('The bot has no notice from this issue to take back, so '
                     'nothing was done.')
        unsaid[key] = result
        save(state)
        out_back.append(num)
        try:
            comment(num, words)
            if result == 'withheld':
                close(num, 'not_planned')
        except Exception as e:
            log('notices: took back #%s (%s), and the comment or close failed: %s'
                % (num, result, pass_failure(e)))

    for num in sorted(notices):
        key = str(num)
        if key in unsaid:
            continue
        if key in said:
            finish(num, said[key])
            continue
        sender, text, problems = notice_of(notices[num], now)
        if problems:
            sig = '\n'.join(problems)
            if refused.get(key) != sig:
                comment(num, 'The bot did not say this notice in #staff-updates:\n\n'
                        + '\n'.join('- ' + p for p in problems)
                        + '\n\nFix the issue and the bot tries again on its next pass.')
                refused[key] = sig
                save(state)
                out_refused.append(num)
            continue
        if notices_this_hour(state, sender, now) >= NOTICE_PER_HOUR:
            # Left open, in order: it goes when the hour has room.
            break
        msg = await send('[%s] %s' % (sender, text))
        if msg is None:
            # Left for the next pass, and the rest after it, so they stay in order.
            break
        said[key] = {'message': getattr(msg, 'id', None), 'at': int(now),
                     'from': sender, 'told': False, 'closed': False}
        refused.pop(key, None)
        save(state)
        out_said.append(num)
        finish(num, said[key])

    for key in [k for k, r in said.items()
                if isinstance(r, dict) and r.get('closed') and now - (r.get('at') or 0) > NOTICE_KEEP]:
        said.pop(key, None)
        unsaid.pop(key, None)
    return out_said, out_back, out_refused


async def _notice_delete(message_id):
    ch = client.get_channel(WATCH_ID) if WATCH_ID else None
    if ch is None or not message_id:
        return 'gone'
    try:
        await ch.get_partial_message(int(message_id)).delete()
        return 'deleted'
    except discord.NotFound:
        return 'gone'


async def watch_staff_notices():
    await client.wait_until_ready()
    if not github_token():
        log('notices: no GitHub token (GITHUB_TOKEN_FILE or GITHUB_TOKEN), so '
            'issues labelled "%s" are not said' % STAFF_NOTICE_LABEL)
        return
    state = _state_read(STAFF_NOTICES)
    if state is None:
        log('notices: %s will not read, so no notice is said until it is fixed '
            'by hand (saying from empty could say one twice)' % STAFF_NOTICES)
        return
    loop = asyncio.get_running_loop()
    cache = {}

    def get(url):
        return _github_get_cached(url, cache)

    async def send(text):
        _ok, msg = await watch_send(text)
        return msg

    def save(s):
        _state_write(STAFF_NOTICES, s)

    while not client.is_closed():
        try:
            notices = await loop.run_in_executor(
                None, github_labelled, STAFF_NOTICE_LABEL, 'open', get)
            take_backs = await loop.run_in_executor(
                None, github_labelled, STAFF_TAKE_BACK_LABEL, 'all', get)
            said, back, refused = await staff_notices_once(
                state, notices, take_backs, send, _notice_delete,
                github_say, github_close, save)
            if said or back or refused:
                log('notices: said %s, took back %s, refused %s'
                    % (said or 'none', back or 'none', refused or 'none'))
        except Exception as e:
            log('notices: a pass failed: %s' % pass_failure(e))
        await asyncio.sleep(NOTICE_EVERY)


# ------------------------------------------------------ release news (#5187) --
#
# A release's news is posted when it is deployed, not when somebody remembers
# to run a step after a Ship. The box's deploy agent, once it has set a
# Deployment to success, leaves that Release's tag, name and notes in
# NEWS_DIR as news-<environment>.json (tools\DeployAgent\News.cs), a folder
# only SYSTEM, Administrators and this bot's account read. Each pass reads
# them and posts each tag not said yet: a dev release (every merge, to Dev,
# Site or Discord bot) in the dev updates channel, by the id in
# dev-channel.txt, and a main release in #news, by the id in news-channel.txt
# (by id and never by name: there are two channels called news). One post a
# tag, however many environments it reached, written down in news-said.json.
# A release whose notes say nothing people would notice (merge-release.yml's
# NOTHING_TO_TELL line) and one deployed over a day ago are written down
# without a post. With no news-said.json yet, what is there already is
# written down unposted: a first start must not announce old releases again.
NEWS_DIR = os.environ.get('THORNSWOOD_NEWS_DIR', r'C:\Thornswood-Deploys\for-bot')
NEWS_SAID = os.path.join(DATA_DIR, 'news-said.json')
NEWS_EVERY = max(30, _int_env('NEWS_EVERY', 60))
NEWS_MAX_AGE = 24 * 3600
NEWS_NOTHING = re.compile(r'^\s*nothing people would notice\b', re.I)
NEWS_KEEP = 200


def _channel_file_id(name):
    """The channel id in name beside this file. 0 without."""
    try:
        with open(os.path.join(HERE, name)) as f:
            return int(f.read().strip())
    except Exception:
        return 0


DEV_NEWS_ID = _int_env('DEV_NEWS_CHANNEL_ID', _channel_file_id('dev-channel.txt'))
MAIN_NEWS_ID = _int_env('NEWS_CHANNEL_ID', _channel_file_id('news-channel.txt'))


def news_channel_of(env):
    """Which news a deployed environment's release is: main for main, dev
       for everything a merge deploys."""
    return 'main' if str(env or '').lower() == 'main' else 'dev'


def news_docs(folder=None):
    """Every news-*.json in the folder as a dict, [] when there is no
       folder, and None when it is there and cannot be read, so an unreadable
       folder is never taken for no news. A file that does not read as news
       is left out."""
    folder = NEWS_DIR if folder is None else folder
    try:
        names = sorted(n for n in os.listdir(folder)
                       if n.startswith('news-') and n.endswith('.json'))
    except FileNotFoundError:
        return []
    except OSError:
        return None
    out = []
    for n in names:
        try:
            with open(os.path.join(folder, n), encoding='utf-8-sig') as f:
                doc = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(doc, dict) and str(doc.get('tag') or '').strip():
            out.append(doc)
    return out


def news_plan(docs, state, now):
    """(channel, doc, how) for each release not written down yet, oldest
       deployment first, each tag once. how is 'post', 'nothing' (its notes
       say nothing people would notice) or 'old' (deployed over a day ago)."""
    said = state.get('said') or {}
    out, seen = [], set()
    for doc in sorted(docs, key=lambda d: str(d.get('deployedUtc') or '')):
        channel = news_channel_of(doc.get('environment'))
        tag = str(doc.get('tag')).strip()
        if tag in (said.get(channel) or {}) or (channel, tag) in seen:
            continue
        seen.add((channel, tag))
        body = strip_footer(str(doc.get('body') or '')).strip()
        at = _github_time(doc.get('deployedUtc'))
        if not body or NEWS_NOTHING.match(body):
            how = 'nothing'
        elif at is not None and now - at > NEWS_MAX_AGE:
            how = 'old'
        else:
            how = 'post'
        out.append((channel, doc, how))
    return out


def news_post_parts(channel, doc):
    """The embed's title, description, footer and colour, in
       Publish-Discord.ps1's shape: the dev build's title says so, blue for
       dev and gold for main."""
    dev = channel == 'dev'
    tag = str(doc.get('tag')).strip()
    title = str(doc.get('name') or '').strip() or tag
    if dev:
        title = 'Dev build: ' + title
    if len(title) > 250:
        title = title[:247] + '...'
    body = strip_footer(str(doc.get('body') or '')).strip()
    if len(body) > 4000:
        cut = body[:4000].rsplit('\n', 1)[0]
        body = (cut if cut else body[:4000]).rstrip() + '\n...'
    return {'title': title, 'description': body,
            'footer': ('dev build ' if dev else '') + tag,
            'color': 5477574 if dev else 13214795,
            'author': 'Thornswood dev' if dev else 'Thornswood'}


async def news_once(state, docs, send, save, now=None):
    """
    One pass. send(channel, parts) posts and gives the message or None.
    state is news-said.json's dict, changed in place; save(state) after each
    release written down. Returns the (channel, tag, how) done this pass. A
    release that could not be posted is left for the next pass, and the ones
    after it in that channel wait, so they stay in order.
    """
    now = time.time() if now is None else now
    said = state.setdefault('said', {})
    done, stuck = [], set()
    for channel, doc, how in news_plan(docs, state, now):
        if channel in stuck:
            continue
        tag = str(doc.get('tag')).strip()
        rec = {'at': int(now), 'how': how}
        if how == 'post':
            msg = await send(channel, news_post_parts(channel, doc))
            if msg is None:
                stuck.add(channel)
                continue
            rec['message'] = getattr(msg, 'id', None)
        mine = said.setdefault(channel, {})
        mine[tag] = rec
        for old in sorted(mine, key=lambda t: mine[t].get('at') or 0)[:-NEWS_KEEP]:
            mine.pop(old, None)
        save(state)
        done.append((channel, tag, how))
    return done


async def _news_send(channel, parts, said_once):
    cid = DEV_NEWS_ID if channel == 'dev' else MAIN_NEWS_ID
    where = 'the dev updates channel' if channel == 'dev' else '#news'
    ch = client.get_channel(cid) if cid else None
    if ch is None:
        if channel not in said_once:
            log('news: %s is %s, so its releases wait unposted'
                % (where, ('channel %d, which this bot cannot see' % cid) if cid else
                   'named by no id (%s beside bot.py)'
                   % ('dev-channel.txt' if channel == 'dev' else 'news-channel.txt')))
            said_once.add(channel)
        return None
    logo = SITE + '/logo.png'
    e = discord.Embed(title=parts['title'], url=SITE + '/news',
                      description=parts['description'], color=parts['color'])
    e.set_author(name=parts['author'], url=SITE, icon_url=logo)
    e.set_thumbnail(url=logo)
    e.set_footer(text=parts['footer'], icon_url=logo)
    try:
        msg = await ch.send(embed=e, allowed_mentions=discord.AllowedMentions.none())
    except Exception as ex:
        if channel not in said_once:
            log('news: could not post in %s: %s' % (where, type(ex).__name__))
            said_once.add(channel)
        return None
    said_once.discard(channel)
    return msg


async def watch_release_news():
    await client.wait_until_ready()
    loop = asyncio.get_running_loop()
    state = _state_read(NEWS_SAID)
    if state is None:
        log('news: %s will not read, so no release news is posted until it is '
            'fixed by hand (posting from empty would say old releases again)'
            % NEWS_SAID)
        return
    said_once = set()
    first = not os.path.exists(NEWS_SAID)
    while not client.is_closed():
        try:
            docs = await loop.run_in_executor(None, news_docs)
            if docs is None:
                if 'folder' not in said_once:
                    log('news: %s will not read, so no release news is posted'
                        % NEWS_DIR)
                    said_once.add('folder')
            elif first:
                # What was deployed before this bot kept a record is written
                # down unposted, once.
                for channel, doc, _how in news_plan(docs, state, time.time()):
                    state.setdefault('said', {}).setdefault(channel, {})[
                        str(doc.get('tag')).strip()] = {'at': int(time.time()), 'how': 'before'}
                _state_write(NEWS_SAID, state)
                first = False
                log('news: started a record in %s; releases deployed from now are posted'
                    % NEWS_SAID)
            else:
                said_once.discard('folder')
                done = await news_once(
                    state, docs, lambda c, p: _news_send(c, p, said_once),
                    lambda s: _state_write(NEWS_SAID, s))
                for channel, tag, how in done:
                    log('news: %s %s (%s)' % (tag, 'posted' if how == 'post' else
                                              'not posted: ' + how, channel))
        except Exception as e:
            log('news: a pass failed: %s' % type(e).__name__)
        await asyncio.sleep(NEWS_EVERY)


# ----------------------------------------------------- the staff channel --
#
# Where the watchdog's messages are said: #staff-updates, by WATCH_ID from
# staff-channel.txt (#2501). There used to be a site watcher here
# as well, asking https://thornswood.net every five minutes since the Caddy
# outage of 21 September. The watchdog on the VPS asks the same address (its
# caddy check), so one outage was two messages from two watchers; since #447
# the watchdog decides and this only delivers (watch_services, below).


async def watch_send(text):
    """
    Say it once, in the staff channel, found by id: (True, the message) when
    it was said, (False, None) when it was not.

    Nothing is guessed and nothing falls back to another channel. If that id is
    not a channel this bot can see, it says so in the bot log and stays quiet in
    Discord, because the only channel it could fall back to by name is the
    public one.
    """
    if not WATCH_ID:
        log('watch: no channel id, so nothing was said. staff-channel.txt is '
            'missing or unreadable; Install-Bot.ps1 sends it with the code.')
        return False, None
    ch = client.get_channel(WATCH_ID)
    if ch is None:
        log('watch: channel %d is not one this bot can see, so nothing was '
            'said.' % WATCH_ID)
        return False, None
    try:
        # The text is the watchdog's own sentence, which can carry a name
        # or a line from somewhere else. Mentions stay off, so @everyone
        # in it is text and not a ping. Discord honors allowed_mentions
        # even when the text still says @everyone.
        msg = await ch.send(text, allowed_mentions=discord.AllowedMentions.none())
        return True, msg
    except Exception:
        log('watch: could not post in #%s:\n' % getattr(ch, 'name', WATCH_ID)
            + traceback.format_exc())
        return False, None


async def watch_say(text):
    """watch_send, True when it was said."""
    ok, _msg = await watch_send(text)
    return ok


def _clock(ms):
    """
    A unix-ms stamp as 'HH:MM on D Month', in this box's own time.

    The site stamps a session's start, end and a log's arrival with the same
    clock the server log uses, so a time named here reads the same as the
    lines on the sessions page.     fromtimestamp is local time, which is what the
    box runs on. %-d is not on Windows, where this runs, so the day is built by
    hand and carries no leading zero. Anything that is not a number, and 0
    itself (the site's stamp for a start or end it never saw), gives '', so a
    row without these fields drops the phrase rather than naming 1970.
    """
    try:
        n = int(ms)
    except (TypeError, ValueError):
        return ''
    if not n:
        return ''
    try:
        t = datetime.datetime.fromtimestamp(n / 1000)
    except (OSError, OverflowError, ValueError):
        return ''
    return '%02d:%02d on %d %s' % (t.hour, t.minute, t.day, t.strftime('%B'))


# A log that arrives within this long of the session ending is the launcher's
# own end-of-session upload, not a backlog, so its arrival is not called out.
TROUBLE_LATE_MS = 5 * 60 * 1000

# How every post _trouble_line makes begins, which is how the one-time look
# through the channel (trouble_backfill) tells one from anything else the bot
# says there.
TROUBLE_HEAD = '**A session went wrong.**'


def _trouble_line(row):
    """
    The staff-channel line for one session that went wrong.

    NAMES THE SESSION'S OWN TIME, not the moment the alert fires. Issue #532:
    a 401 held Patrick's 23 September logs until 14:09 the next day, when a
    newer launcher uploaded the backlog, and the alert read ~14:10 as if the
    crash had just happened. The session had started 20:07 the evening before.
    So the start is named, and when the logs arrived well after the session
    ended (a late upload, not the launcher's own end-of-session send) that is
    said too, so a backlog no longer looks like a fresh failure.

    A pure function of the row, so the harness can check the wording without a
    Discord, a clock or the file. A row with no start or end (older rows, or a
    session whose ends were never seen) simply drops those phrases.
    """
    who = row.get('name') or row.get('who') or 'somebody'
    where = row.get('channel') or ''
    where = {'dev': 'the dev build', 'main': 'the main build'}.get(
        where, 'a build it did not name')
    line = (row.get('line') or '').strip()

    started = _clock(row.get('start'))
    when = (' It started %s.' % started) if started else ''

    late = ''
    try:
        end = int(row.get('end') or 0)
        arrived = int(row.get('at') or 0)
    except (TypeError, ValueError):
        end = arrived = 0
    if end and arrived and arrived - end > TROUBLE_LATE_MS:
        got = _clock(arrived)
        if got:
            late = (' The logs did not arrive until %s, well after it ended, '
                    'so this is a late upload rather than a new failure.' % got)

    return (
        TROUBLE_HEAD + ' %s, on %s%s.%s%s\n%s\n%s\n'
        'The logs are on the sessions page under that session, '
        'and it is the red one.'
        % (who,
           where,
           (', launcher %s' % row['version']) if row.get('version') else '',
           when,
           late,
           row.get('why') or 'something went wrong',
           ('```\n%s\n```' % line[:400]) if line else ''))


def _trouble_rows():
    """
    The rows in trouble.json, or None when the file is not there or cannot be
    read. None is never taken for an empty file: a post is deleted because its
    row has gone, so a file that could not be read must delete nothing.
    """
    try:
        with open(TROUBLE_FILE, encoding='utf-8') as f:
            rows = json.load(f)
    except Exception:
        return None
    return rows if isinstance(rows, list) else None


def _trouble_sessions(rows):
    return set(r['session'] for r in rows
               if isinstance(r, dict) and r.get('session'))


def trouble_remember(sid, msg, path=None):
    """Writes down which message said session sid went wrong."""
    path = path or TROUBLE_POSTS
    state = _state_read(path)
    if state is None:
        log('trouble: %s cannot be read, so the post for session %s is not '
            'written down and will not be deleted when its logs go'
            % (path, sid))
        return False
    posts = state.setdefault('posts', {})
    posts[str(sid)] = {'channel': msg.channel.id, 'message': msg.id}
    try:
        _state_write(path, state)
    except Exception as e:
        log('trouble: could not write %s, so the post for session %s will not '
            'be deleted when its logs go: %s: %s'
            % (path, sid, type(e).__name__, e))
        return False
    return True


async def trouble_forget(rows, path=None):
    """
    A FAILED SESSION'S POST GOES WHEN ITS ROW GOES (#3942). The post carries
    the person's name and a line out of their logs. The site keeps the row in
    trouble.json exactly as long as the session and its logs: it ages out at
    365 days, stays while staff keep the session, and goes with a deletion
    request (freshTrouble and the deletion sweep in site/server.js). The
    oldest also goes past the file's last 200 rows. Nothing deleted the post,
    so it stayed in the channel after all of that.

    So every post this bot makes is written down against its session in
    TROUBLE_POSTS, and here each one whose session is no longer in rows is
    deleted. Returns (deleted, failed). A post already gone from Discord (staff
    deleted it) is taken off the list; any other failure is a line with
    Discord's reason, and the post stays on the list for the next pass. Said
    in bot.log by session id and count, never what a post said.
    """
    if rows is None:
        return 0, 0
    path = path or TROUBLE_POSTS
    state = _state_read(path)
    if state is None:
        log('trouble: %s cannot be read, so no post was deleted this pass'
            % path)
        return 0, 1
    posts = state.get('posts') or {}
    present = _trouble_sessions(rows)
    deleted = failed = 0
    changed = False
    for sid in [k for k in posts if k not in present]:
        rec = posts.get(sid) if isinstance(posts.get(sid), dict) else {}
        try:
            cid, mid = int(rec.get('channel')), int(rec.get('message'))
        except (TypeError, ValueError):
            log('trouble: the post for session %s has no message written down, '
                'so it is taken off the list' % sid)
            del posts[sid]
            changed = True
            continue
        ch = client.get_channel(cid)
        if ch is None:
            failed += 1
            log('trouble: channel %d of the post for session %s is not one this '
                'bot can see, so it is not deleted this pass' % (cid, sid))
            continue
        try:
            await ch.get_partial_message(mid).delete()
            deleted += 1
        except discord.NotFound:  # staff deleted it already: it is gone, as wanted
            pass
        except Exception as e:
            failed += 1
            log('trouble: could not delete the post for session %s: %s: %s'
                % (sid, type(e).__name__, e))
            continue
        del posts[sid]
        changed = True
    if changed:
        state['posts'] = posts
        try:
            _state_write(path, state)
        except Exception as e:
            log('trouble: could not write %s after deleting posts: %s: %s'
                % (path, type(e).__name__, e))
    if deleted:
        log('trouble: deleted %d failed-session post(s) whose session has left '
            'trouble.json' % deleted)
    return deleted, failed


def _trouble_post_matches(content, row):
    """
    True when a post the bot made before #3942 is about this row. The wording
    has changed since the first posts (#532), so the row's own text is looked
    for rather than the whole line: the name, and the log line in its code
    block or, with no line, the reason.
    """
    if content == _trouble_line(row)[:1900]:
        return True
    who = row.get('name') or row.get('who') or ''
    line = (row.get('line') or '').strip()
    mark = ('```\n%s\n```' % line[:400]) if line else (row.get('why') or '')
    return bool(who) and bool(mark) and who in content and mark in content


async def trouble_backfill(rows, path=None):
    """
    The posts made before #3942 were never written down. Once, the first time
    the bot comes up with this, it looks through the trouble channel for its
    own posts that begin with TROUBLE_HEAD, writes down each whose row is still
    in trouble.json, and deletes the rest, whose session and logs are already
    gone. A post it cannot match to a row is one of those. Returns
    (deleted, failed); with any failure the look runs again next start.
    """
    if rows is None:
        return 0, 0
    path = path or TROUBLE_POSTS
    state = _state_read(path)
    if state is None or state.get('backfilled'):
        return 0, 0
    ch = _trouble_channel()
    bot_id = getattr(client.user, 'id', None)
    if ch is None or bot_id is None:
        return 0, 0
    posts = state.setdefault('posts', {})
    known = set(str(r.get('message')) for r in posts.values()
                if isinstance(r, dict))
    rows = [r for r in rows if isinstance(r, dict) and r.get('session')]
    deleted = failed = 0
    try:
        async for m in ch.history(limit=None):
            if getattr(getattr(m, 'author', None), 'id', None) != bot_id:
                continue
            content = getattr(m, 'content', '') or ''
            if not content.startswith(TROUBLE_HEAD) or str(m.id) in known:
                continue
            row = next((r for r in rows if str(r['session']) not in posts
                        and _trouble_post_matches(content, r)), None)
            if row is not None:
                posts[str(row['session'])] = {'channel': ch.id, 'message': m.id}
                continue
            try:
                await m.delete()
                deleted += 1
            except discord.NotFound:  # already gone from the channel, as wanted
                pass
            except Exception as e:
                failed += 1
                log('trouble: could not delete an old failed-session post '
                    '(%s): %s: %s' % (m.id, type(e).__name__, e))
    except Exception as e:
        failed += 1
        log('trouble: could not read #%s for the old failed-session posts: '
            '%s: %s' % (getattr(ch, 'name', '?'), type(e).__name__, e))
    if not failed:
        state['backfilled'] = True
    try:
        _state_write(path, state)
    except Exception as e:
        log('trouble: could not write %s after the look for old posts: %s: %s'
            % (path, type(e).__name__, e))
    log('trouble: the old failed-session posts: %d written down, %d deleted, '
        '%d failed' % (len(posts), deleted, failed))
    return deleted, failed


async def watch_trouble():
    """
    Say in the staff channel when a session goes wrong, and take the post down
    when that session's logs go (trouble_forget).

    The site reads every session's logs as they arrive and appends the ones
    that went wrong to trouble.json. This reads that file and says each new one
    once. A file rather than a request because both run on this box.

    WHAT IT REMEMBERS AND WHY. The session ids already in the file when this
    starts are treated as said. Without that, every restart of the bot would
    re-announce the last two hundred, which is the fastest way to make a staff
    channel unreadable and therefore unread. It means a session that went wrong
    while the bot was down is not announced, and that is the right trade: it is
    still on the page, in red, which is where somebody looks.

    Nothing in here may end the loop, for the same reason as the site watcher:
    a watcher that dies quietly looks exactly like everything being fine.
    """
    await client.wait_until_ready()

    loop = asyncio.get_running_loop()
    said = _trouble_sessions(await loop.run_in_executor(None, _trouble_rows) or [])
    ch = _trouble_channel()
    log('trouble: watching %s every %ds, speaking in %s, %d already there and '
        'treated as said'
        % (TROUBLE_FILE, TROUBLE_EVERY,
           ('#' + ch.name) if ch is not None else 'NOWHERE, see above',
           len(said)))

    first = True
    while not client.is_closed():
        try:
            rows = await loop.run_in_executor(None, _trouble_rows)
            if first:
                first = False
                await trouble_backfill(rows)
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                sid = row.get('session') or ''
                if not sid or sid in said:
                    continue
                said.add(sid)
                msg = await trouble_say(_trouble_line(row))
                if msg is not None:
                    trouble_remember(sid, msg)
            await trouble_forget(rows)
        except Exception:
            log('trouble: the check itself failed, carrying on:\n'
                + traceback.format_exc())
        await asyncio.sleep(TROUBLE_EVERY)


def _trouble_channel():
    """
    The channel a session that went wrong is announced in: #staff-updates, by
    the id from staff-channel.txt or TROUBLE_CHANNEL_ID, and nothing else.

    No id, or an id that is not a channel this bot can see, is a line in the
    bot log and silence in Discord, the way watch_say has always been. Until
    #2940 it fell back to a channel named staff-general, so the same alert went
    to #staff-updates on a box set up right and to the team's everyday channel
    on one that was not, and nothing in Discord said which. A guess by name
    also hid the missing or wrong id, which is the thing to fix: Install-Bot
    sends staff-channel.txt with the code. And a name can match the wrong
    channel; this server has two called news, one staff and one public.
    """
    if not TROUBLE_ID:
        log('trouble: no channel id, so nothing is said. staff-channel.txt is '
            'missing or unreadable; Install-Bot.ps1 sends it with the code.')
        return None
    ch = client.get_channel(TROUBLE_ID)
    if ch is None:
        log('trouble: channel %d is not one this bot can see, so nothing is '
            'said.' % TROUBLE_ID)
    return ch


async def trouble_say(text):
    """Say it once, in the staff channel. Same rules as watch_say. The
    message, or None when nothing was said."""
    ch = _trouble_channel()
    if ch is None:
        return None
    try:
        # The line carries a name and a line from a log, both from somewhere
        # else. Mentions stay off, as in watch_say and report_say, so an
        # @everyone in it is text and not a ping.
        return await ch.send(text[:1900],
                             allowed_mentions=discord.AllowedMentions.none())
    except Exception:
        log('trouble: could not post in #%s:\n' % getattr(ch, 'name', '?')
            + traceback.format_exc())
        return None


# ------------------------------------------------------ the box's watchdog --
#
# Watch-Services.ps1 puts a watchdog on the VPS that restarts whatever stops
# answering, and since issue #447 it also decides what is down: one message
# when a thing dies and one when it is back, however long it stays down and
# however often it flaps. It writes them to alerts.jsonl in its folder, one
# JSON line each (id, at, service, kind, text). This says each one in the
# staff channel, by id through watch_say, which has no public fallback, and
# writes its id to alerts-sent-bot.txt, so it is said once across restarts of
# the bot too.
#
# When this bot is down, or up and not posting, the watchdog posts the message
# itself through a webhook kept on the box and writes its id to
# alerts-sent-webhook.txt. This reads that list too, so what the webhook said
# is not said again when the bot comes back.
#
# The watchdog decides and this only delivers, so there is no counting here.
# It replaced a reader of watch.log that tried to work out outages from the
# watchdog's sentences, and repeated "needs a look" every hour.
# tests\test-watch-alerts.ps1 drives the watchdog, and test-watch-services.py
# drives this against an outbox the real watchdog wrote.
#
# WHAT IT CANNOT CATCH is the whole box going down, which takes the watchdog
# with it. That needs something off the machine (issue #448).
WATCH_ALERTS = os.path.join(WATCH_DIR, 'alerts.jsonl')
WATCH_SENT_BOT = os.path.join(WATCH_DIR, 'alerts-sent-bot.txt')
WATCH_SENT_HOOK = os.path.join(WATCH_DIR, 'alerts-sent-webhook.txt')
# Taking a notice back (#3328). Say-Staff.ps1 -Unsay puts its id in
# alerts-unsay.txt, through say-staff.ps1 on the box, which takes back only the
# sender's own notices. The bot keeps the Discord message each notice became in
# staff-messages.txt, and what it did with each ask in staff-unsaid.txt, both
# in its own data folder, the one place it writes; say-staff.ps1 -Check reads
# the second. On 22 Oct a notice that should not have gone out stayed up until
# Patrick deleted it by hand: nothing knew which message it was.
WATCH_UNSAY = os.path.join(WATCH_DIR, 'alerts-unsay.txt')
STAFF_MESSAGES = os.path.join(DATA_DIR, 'staff-messages.txt')
STAFF_UNSAID = os.path.join(DATA_DIR, 'staff-unsaid.txt')
# How far back a notice said before staff-messages.txt existed is looked for.
UNSAY_LOOK_BACK = 200
# The watchdog's $alertMaxAge: a message a day late is noise, not news.
WATCH_ALERT_MAX_AGE = 24 * 3600


def watch_alerts_due(lines, sent, now):
    """
    The (id, text) of each message in the outbox still to be said, in order.

    lines are the outbox's lines, sent every id already said by the bot or the
    webhook, now the time in unix seconds. A line that is not a message is
    skipped rather than stopping the rest, and so is one older than
    WATCH_ALERT_MAX_AGE. An id twice in the outbox is said once.
    """
    out = []
    seen = set(sent)
    for raw in lines:
        try:
            a = json.loads(raw)
            aid = str(a['id']).strip()
            text = str(a['text'])
            at = int(a['at'])
        except Exception:
            continue
        if not aid or not text.strip() or aid in seen:
            continue
        if now - at > WATCH_ALERT_MAX_AGE:
            continue
        seen.add(aid)
        out.append((aid, text[:1900]))
    return out


def _watch_lines(path):
    """
    Every whole, non-empty line of path, [] when there is no such file, and
    None when it is there and cannot be read, so an unreadable outbox is never
    taken for an empty one.

    A last line with no line ending is left for the next read: the watchdog
    may be halfway through writing it.
    """
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except FileNotFoundError:
        return []
    except Exception:
        return None
    parts = data.decode('utf-8-sig', errors='replace').split('\n')
    return [p.strip() for p in parts[:-1] if p.strip()]


def _watch_mark(aid):
    """Write down that the bot said it. Blocking, so run through an executor."""
    with open(WATCH_SENT_BOT, 'a', encoding='ascii', errors='replace') as f:
        f.write(aid + '\r\n')


def _watch_note(path, *fields):
    """One tab separated line onto path. Blocking, so run through an executor."""
    with open(path, 'a', encoding='utf-8') as f:
        f.write('\t'.join(str(x).replace('\t', ' ').replace('\n', ' ')
                          for x in fields) + '\n')


def _watch_table(path):
    """{first field: the rest} of a tab separated file, the last line winning.
    {} when there is none, None when it is there and cannot be read."""
    lines = _watch_lines(path)
    if lines is None:
        return None
    out = {}
    for line in lines:
        parts = line.split('\t')
        if parts[0]:
            out[parts[0]] = parts[1:]
    return out


def unsay_plan(asked, done, messages, by_bot, by_hook, texts):
    """
    What to do with each notice asked to be taken back, in the order asked:
    (id, how). how is 'message' (its Discord message is known), 'look' (the bot
    said it before it kept message ids, so it is looked for by its words),
    'webhook' (the watchdog's webhook said it, which the bot cannot delete),
    'withhold' (not said yet, so it never is) or 'unknown' (no such notice).
    An id already done, or asked twice, is planned once.
    """
    out = []
    seen = set(done)
    for aid in asked:
        aid = aid.strip()
        if not aid or aid in seen:
            continue
        seen.add(aid)
        if aid in messages:
            how = 'message'
        elif aid in by_bot:
            how = 'look'
        elif aid in by_hook:
            how = 'webhook'
        elif aid in texts:
            how = 'withhold'
        else:
            how = 'unknown'
        out.append((aid, how))
    return out


async def watch_unsay(lines, said):
    """
    Take back every notice asked for that is not done yet. lines is the
    outbox, said the ids this run of the bot said. Each ask is written down in
    staff-unsaid.txt once, whatever came of it, so a failed one is not tried
    every minute for ever; its line says why.
    """
    loop = asyncio.get_running_loop()
    asked = await loop.run_in_executor(None, _watch_lines, WATCH_UNSAY)
    if not asked:
        return
    done = await loop.run_in_executor(None, _watch_table, STAFF_UNSAID)
    messages = await loop.run_in_executor(None, _watch_table, STAFF_MESSAGES)
    mine = await loop.run_in_executor(None, _watch_lines, WATCH_SENT_BOT)
    hook = await loop.run_in_executor(None, _watch_lines, WATCH_SENT_HOOK)
    if done is None or messages is None or mine is None or hook is None:
        return
    texts = {}
    for raw in lines:
        try:
            a = json.loads(raw)
            texts[str(a['id']).strip()] = str(a['text'])[:1900]
        except Exception:
            continue
    plan = unsay_plan(asked, done, messages, set(mine) | said, set(hook), texts)
    ch = client.get_channel(WATCH_ID) if WATCH_ID else None
    for aid, how in plan:
        result = how
        try:
            if how == 'withhold':
                # Marked said, so neither this loop nor the watchdog's webhook
                # ever says it; staff-unsaid.txt says why it is marked.
                await loop.run_in_executor(None, _watch_mark, aid)
                said.add(aid)
                result = 'withheld'
            elif how in ('message', 'look'):
                if ch is None:
                    continue
                target = None
                if how == 'message':
                    target = ch.get_partial_message(int(messages[aid][-1]))
                else:
                    me = getattr(client.user, 'id', None)
                    async for m in ch.history(limit=UNSAY_LOOK_BACK):
                        if getattr(m.author, 'id', None) == me and m.content == texts.get(aid):
                            target = m
                            break
                if target is None:
                    result = 'gone'
                else:
                    try:
                        await target.delete()
                        result = 'deleted'
                    except discord.NotFound:
                        result = 'gone'
        except Exception as e:
            log('services: could not take back %s:\n%s' % (aid, traceback.format_exc()))
            result = 'failed ' + type(e).__name__
        await loop.run_in_executor(None, _watch_note, STAFF_UNSAID, aid, result)
        log('services: took back %s: %s' % (aid, result))


async def watch_services():
    """
    Every WATCH_READ_EVERY seconds, say what the watchdog's outbox holds that
    nobody has said yet.

    A message that could not be said is left unmarked and the rest of that
    round waits, so they stay in order; the watchdog posts it through its
    webhook once it has waited long enough.

    Nothing in here may end the loop: a watcher that dies quietly looks
    exactly like everything being fine.
    """
    await client.wait_until_ready()
    loop = asyncio.get_running_loop()
    said = set()
    unreadable = False
    log('services: saying what %s holds, every %ds, in channel %d'
        % (WATCH_ALERTS, WATCH_READ_EVERY, WATCH_ID))

    while not client.is_closed():
        try:
            lines = await loop.run_in_executor(None, _watch_lines, WATCH_ALERTS)
            mine = await loop.run_in_executor(None, _watch_lines, WATCH_SENT_BOT)
            hook = await loop.run_in_executor(None, _watch_lines, WATCH_SENT_HOOK)
            if lines is None or mine is None or hook is None:
                if not unreadable:
                    log('services: could not read the watchdog\'s files in %s, '
                        'trying again every %ds' % (WATCH_DIR, WATCH_READ_EVERY))
                unreadable = True
            else:
                unreadable = False
                await watch_unsay(lines, said)
                due = watch_alerts_due(lines, said | set(mine) | set(hook),
                                       int(time.time()))
                for aid, text in due:
                    ok, msg = await watch_send(text)
                    if not ok:
                        break
                    said.add(aid)
                    log('services: said ' + aid)
                    await loop.run_in_executor(None, _watch_mark, aid)
                    if getattr(msg, 'id', None):
                        await loop.run_in_executor(None, _watch_note, STAFF_MESSAGES,
                                                   aid, WATCH_ID, msg.id)
        except Exception:
            log('services: the check itself failed, carrying on:\n'
                + traceback.format_exc())
        await asyncio.sleep(WATCH_READ_EVERY)


def report_text(row):
    """
    One report from the public page, as the staff channel reads it.

    Every word of it was typed by a stranger with no account, so it is escaped
    before it goes anywhere near Discord: an @everyone in a title is text, not
    a ping, and a masked link is shown as what it is. as_typed is the same
    escaping the ticket threads use.
    """
    clean = as_typed

    by = clean(row.get('by'), 40)
    detail = clean(row.get('detail'), 400)
    kind = row.get('kind')

    # From inside the game (#414): /helpme and /report. The profile ids in
    # the detail are the client's claim, and the detail says so. A report
    # about somebody never pings: the send switches every mention off.
    if str(row.get('from') or '').startswith('in game'):
        where = ' on the dev server' if 'dev' in str(row.get('from')) else ''
        if kind == 'help':
            head = '**%s asked for help in game%s**' % (by or 'Somebody', where)
        else:
            head = ('**%s reported %s in game%s**'
                    % (by or 'Somebody', clean(row.get('about'), 60) or 'somebody',
                       where))
        return '%s\n%s%s' % (head, clean(row.get('title'), 300) or '(nothing said)',
                             ('\n' + detail) if detail else '')

    # A report about a person from the site, which the site only takes from
    # somebody signed in with Discord, so it always has a name and an account.
    if kind == 'report':
        acct = str(row.get('discordId') or '')
        return ('**%s reported %s on the site**%s.\n%s%s'
                % (by or 'Somebody', clean(row.get('about'), 60) or 'somebody',
                   (' (Discord <@%s>)' % acct) if acct.isdigit() else '',
                   clean(row.get('title'), 200) or '(no title)',
                   ('\n' + detail) if detail else ''))

    kind = 'An idea' if kind == 'idea' else 'A problem'
    return ('**%s sent in on the public report page**, %s.\n%s%s'
            % (kind,
               ('from ' + by) if by else 'with no name left',
               clean(row.get('title'), 200) or '(no title)',
               ('\n' + detail) if detail else ''))


async def report_say(text):
    """Same channel as trouble_say, with every mention switched off."""
    ch = _trouble_channel()
    if ch is None:
        return
    try:
        await ch.send(text[:1900], suppress_embeds=True,
                      allowed_mentions=discord.AllowedMentions.none())
    except Exception:
        log('reports: could not post in #%s:\n' % getattr(ch, 'name', '?')
            + traceback.format_exc())


async def watch_reports():
    """
    Say in the staff channel when somebody sends something in on the public
    report page.

    The page tells them "Somebody will read it", and until this the only place
    it could be read was the inbox on the hub, which nobody opens unless they
    already know something is there, and the To Do List has the hub going
    altogether. The site writes inbox.json on this same box, so this reads it
    the way watch_trouble reads trouble.json.

    Tickets are in that file as well and are left alone: they came from
    Discord, and their thread is already where staff read them.

    The ids already there when this starts are treated as said, for the same
    reason as watch_trouble. A file that is on disk but will not parse, which
    is what a read in the middle of the site writing it looks like, is waited
    out rather than read as empty, because empty would make every row in it
    new on the next look.
    """
    await client.wait_until_ready()

    def read_all():
        try:
            with open(REPORTS_FILE, encoding='utf-8') as f:
                rows = json.load(f)
        except FileNotFoundError:
            return []
        except Exception:
            return None
        return rows if isinstance(rows, list) else None

    # A problem from the game (#3155) is said by watch_problems once it is
    # on the board, with its issue number, so it is not said here as well.
    def public(row):
        return (isinstance(row, dict) and bool(row.get('id'))
                and row.get('kind') not in ('ticket', 'problem'))

    loop = asyncio.get_running_loop()
    rows = await loop.run_in_executor(None, read_all)
    while rows is None:
        await asyncio.sleep(5)
        rows = await loop.run_in_executor(None, read_all)
    said = set(row['id'] for row in rows if public(row))
    ch = _trouble_channel()
    log('reports: watching %s every %ds, speaking in %s, %d already there and '
        'treated as said'
        % (REPORTS_FILE, REPORTS_EVERY,
           ('#' + ch.name) if ch is not None else 'NOWHERE, see above',
           len(said)))

    while not client.is_closed():
        try:
            rows = await loop.run_in_executor(None, read_all)
            fresh = [r for r in (rows or []) if public(r) and r['id'] not in said]
            for r in fresh:
                said.add(r['id'])
            if len(fresh) > REPORTS_AT_ONCE:
                await report_say(
                    '**%d reports came in, from the site and the game,** since the '
                    'last look, which is more than people send and more than '
                    'this channel should carry one at a time. They are in the '
                    'inbox on the site.' % len(fresh))
            else:
                # The file is newest first; the channel reads oldest first.
                for r in reversed(fresh):
                    await report_say(report_text(r))
        except Exception:
            log('reports: the check itself failed, carrying on:\n'
                + traceback.format_exc())
        await asyncio.sleep(REPORTS_EVERY)


# ------------------------------------------------------ report a problem --
#
# Testers' problems onto the board (#3155). Patrick, 21 Oct: a Discord button
# and an in-game button that file an issue on the board with the log and
# where they are.
#
# In the game it is Report a problem on the help panel. The game server sends
# it to the site (kind 'problem' in inbox.json, beside the other reports),
# with where the character stands and the session the launcher has open for
# that account; watch_problems reads it there and files the issue. In Discord
# it is the panel in #test-findings, which opens a form and files the issue
# itself. Either way the issue carries PROBLEM_LABELS, so staff read it before
# it is Main or Dev Findings: those two put an issue on the public
# #known-issues, which is for real bugs only (#3137).
#
# The logs are never copied into the issue: the launcher sends them to the
# site when the game closes, and the issue links that session on the hub's
# sessions page (/sessions?find=), where staff read them with the game
# server's own lines for the same window.
#
# GITHUB_TOKEN needs issues write for this, as for github_say. A refusal is
# said once in the staff channel and the report stays in the inbox, where the
# next look files it once GitHub takes it.
PROBLEM_LABELS = [l.strip() for l in
                  os.environ.get('PROBLEM_LABELS', 'Tester report,area: triage').split(',')
                  if l.strip()]
PROBLEMS_FILED = os.path.join(DATA_DIR, 'problems-filed.json')
PROBLEM_CHANNEL = os.environ.get('PROBLEM_CHANNEL', '').strip().lower() or FINDINGS_NAME
# Who may use the Discord panel: testers and staff.
_TESTER_RAW = [r.strip() for r in os.environ.get('TESTER_ROLES', 'Playtester').split(',')
               if r.strip()]
TESTER_IDS, TESTER_NAMES = _role_tokens(_TESTER_RAW)
# The same as the game and the site take from one person: five an hour.
PROBLEM_HOUR = 5
_problems_by = {}
PROBLEM_PANEL = ('**Report a problem**\n'
                 'Something broken in the game, the launcher or the site? Press the button, '
                 'say what went wrong and what you were doing, and it goes on the board for '
                 'the developers. In the game it is on the help panel (F7), under Getting '
                 'help, and it takes where you are standing with it.')


def _when_text(ms):
    """A moment as people read it, in UTC, on the twelve hour clock."""
    try:
        t = datetime.datetime.fromtimestamp(float(ms) / 1000.0, datetime.timezone.utc)
    except Exception:
        return 'an unknown time'
    hour = t.hour % 12 or 12
    return '%d %s %d, %d:%02d %s UTC' % (t.day, t.strftime('%b'), t.year, hour, t.minute,
                                         'AM' if t.hour < 12 else 'PM')


def _issue_text(v, n):
    """Words somebody typed, inside an issue, as typed: in a <pre>, where
       GitHub reads no markdown and links no mention, with &, < and > made
       entities so nothing in it can close the block."""
    v = str(v or '').strip()[:n]
    return '<pre>' + v.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;') + '</pre>'


def _issue_title(text):
    """The issue's title: the first words of what they said, cut at a word."""
    t = re.sub(r'\s+', ' ', str(text or '')).strip()
    if len(t) <= 90:
        return t or 'A problem with nothing said'
    cut = t[:90]
    at = cut.rfind(' ')
    return (cut[:at] if at > 45 else cut).rstrip(' ,.;:') + '...'


def problem_issue(row):
    """The issue for a problem sent from the game: (title, body)."""
    server = 'the dev server' if row.get('server') == 'dev' else 'the main server'
    session = str(row.get('session') or '')
    pos = row.get('pos') if isinstance(row.get('pos'), list) else []
    where = str(row.get('cell') or 'an unknown place')
    if len(pos) == 3:
        where += ', at ' + ', '.join(str(x) for x in pos)
    who = '%s, profile %s' % (str(row.get('by') or 'Somebody')[:60], row.get('profileId') or 'unknown')
    if str(row.get('discordId') or '').isdigit():
        who += ', Discord account %s' % row.get('discordId')
    if session:
        logs = ('[this game\'s session](%s/sessions?find=%s) on the hub. The launcher sends '
                'its logs when the game closes; More details there has them, with the game '
                'server\'s own lines for the same window.' % (SITE, urllib.parse.quote(session)))
    else:
        logs = ('none tied to it: the site found no session open for this account when the '
                'report came in, so look under their Discord account on the hub\'s sessions page.')
    # No issue number in the body: each would link itself on that issue.
    body = ('A tester reported this in game on %s with Report a problem on the help panel '
            'of the game. Read it, then give it its area and Main or Dev Findings, or close it.\n\n'
            '**What they said**\n%s\n\n'
            '- **Who:** %s\n'
            '- **Where:** %s (where the game server had the character)\n'
            '- **When:** %s\n'
            '- **Logs:** %s\n'
            % (server, _issue_text(row.get('title'), 1000), who, where,
               _when_text(row.get('at')), logs))
    return _issue_title(row.get('title')), body


def problem_issue_discord(name, discord_id, what, doing, server, at_ms):
    """The issue for a problem sent from the Discord panel: (title, body)."""
    body = ('A tester reported this in Discord with the Report a problem panel in #%s. '
            'Read it, then give it its area and Main or Dev Findings, or close it.\n\n'
            '**What went wrong**\n%s\n\n'
            '**What they were doing, and where**\n%s\n\n'
            '- **Who:** %s, Discord account %s\n'
            '- **Server:** %s\n'
            '- **When:** %s\n'
            '- **Logs:** [their sessions](%s/sessions?find=%s) on the hub, newest first. A '
            'report from Discord is tied to no one game, so the session is the one closest '
            'to the time above.\n'
            % (PROBLEM_CHANNEL, _issue_text(what, 1000),
               _issue_text(doing, 1000) if str(doing or '').strip() else 'nothing said',
               str(name or 'Somebody')[:60], discord_id,
               str(server or '').strip()[:40] or 'not said', _when_text(at_ms),
               SITE, urllib.parse.quote(str(discord_id))))
    return _issue_title(what), body


def github_file(title, body, labels):
    """Files an issue on the board. The bot's token needs issues write for
       this, as for github_say. Returns the issue's number."""
    token = github_token()
    if not token:
        raise RuntimeError('no GitHub token: none in GITHUB_TOKEN_FILE and no GITHUB_TOKEN in bot.env.json')
    req = urllib.request.Request(
        '%s/repos/%s/issues' % (GITHUB_API, known_repo_now()),
        data=json.dumps({'title': title, 'body': body, 'labels': labels}).encode('utf-8'),
        method='POST',
        headers={'Accept': 'application/vnd.github+json',
                 'Authorization': 'Bearer ' + token,
                 'User-Agent': 'thornswood-bot',
                 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return int(json.loads(r.read().decode('utf-8'))['number'])


def _filed_read():
    try:
        with open(PROBLEMS_FILED, encoding='utf-8') as f:
            got = json.load(f)
        return got if isinstance(got, dict) else {}
    except FileNotFoundError:
        return {}


def _filed_write(filed):
    tmp = PROBLEMS_FILED + '.new'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(filed, f)
    os.replace(tmp, PROBLEMS_FILED)


async def problems_once(rows, filed, file=None, say=None, save=None):
    """
    Files every problem in rows that filed has no number for, oldest first,
    and says each in the staff channel with its number. Returns the reasons
    it could not file, for the caller to say once. filed is changed in place
    and saved after each issue, so a stop half way never files one twice.
    """
    file = file or github_file
    say = say or report_say
    save = save or _filed_write
    loop = asyncio.get_running_loop()
    failed = []
    todo = [r for r in (rows or []) if isinstance(r, dict) and r.get('kind') == 'problem'
            and r.get('id') and str(r['id']) not in filed]
    for r in reversed(todo):
        title, body = problem_issue(r)
        try:
            number = await loop.run_in_executor(None, file, title, body, PROBLEM_LABELS)
        except Exception as e:
            failed.append('%s: %s' % (type(e).__name__, str(e)[:200]))
            break
        filed[str(r['id'])] = number
        await loop.run_in_executor(None, save, filed)
        where = ' on the dev server' if r.get('server') == 'dev' else ''
        await say('**%s reported a problem in game%s**, on the board as #%d.\n%s'
                  % (as_typed(r.get('by'), 40) or 'Somebody', where, number,
                     as_typed(r.get('title'), 300)))
    return failed


async def watch_problems():
    """Files the problems sent from the game on the board (#3155)."""
    await client.wait_until_ready()
    loop = asyncio.get_running_loop()

    def read_rows():
        try:
            with open(REPORTS_FILE, encoding='utf-8') as f:
                rows = json.load(f)
        except FileNotFoundError:
            return []
        except Exception:
            return None
        return rows if isinstance(rows, list) else None

    try:
        filed = await loop.run_in_executor(None, _filed_read)
    except Exception:
        # Not read is not empty: empty would file every problem again.
        log('problems: %s will not read, so nothing is filed until it does:\n' % PROBLEMS_FILED
            + traceback.format_exc())
        return
    log('problems: filing what the game sends from %s every %ds, %d filed so far'
        % (REPORTS_FILE, REPORTS_EVERY, len(filed)))
    said_why = ''
    while not client.is_closed():
        try:
            rows = await loop.run_in_executor(None, read_rows)
            if rows is not None:
                failed = await problems_once(rows, filed)
                why = failed[0] if failed else ''
                if why and why != said_why:
                    await report_say('**A problem sent from the game could not be filed on the '
                                     'board**: GitHub said %s. It stays in the inbox on the site, '
                                     'and it is filed as soon as GitHub takes it.' % as_typed(why, 300))
                    log('problems: could not file:', why)
                said_why = why
        except Exception:
            log('problems: the check itself failed, carrying on:\n' + traceback.format_exc())
        await asyncio.sleep(REPORTS_EVERY)


def problem_refusal(member, now):
    """Why this person may not send a problem from Discord now, or ''."""
    if not (is_staff(member) or _who_hits(member, TESTER_IDS, TESTER_NAMES)):
        return ('Report a problem is for playtesters and staff. Apply to playtest in '
                '#apply-to-playtest, or ask in #get-help.')
    seen = [t for t in _problems_by.get(member.id, []) if now - t < 3600]
    _problems_by[member.id] = seen
    if len(seen) >= PROBLEM_HOUR:
        wait = int((seen[0] + 3600 - now) // 60) + 1
        return ('That is %d problems from you in the last hour, which is as many as this '
                'takes. Try again in %d minutes.' % (PROBLEM_HOUR, wait))
    return ''


class ProblemModal(discord.ui.Modal):
    def __init__(self):
        super().__init__(title='Report a problem')
        self.what = discord.ui.TextInput(
            label='What went wrong',
            placeholder='What you saw, and what you expected instead',
            style=discord.TextStyle.paragraph, required=True, max_length=1000)
        self.doing = discord.ui.TextInput(
            label='What you were doing, and where',
            placeholder='Which town or place, and what you pressed',
            style=discord.TextStyle.paragraph, required=False, max_length=1000)
        self.server = discord.ui.TextInput(
            label='Which server, main or dev',
            placeholder='main', style=discord.TextStyle.short,
            required=False, max_length=40)
        self.add_item(self.what)
        self.add_item(self.doing)
        self.add_item(self.server)

    async def on_submit(self, interaction):
        now = time.time()
        no = problem_refusal(interaction.user, now)
        if no:
            await interaction.response.send_message(no, ephemeral=True)
            return
        # Counted before the first await, so two forms at once cannot both pass.
        _problems_by.setdefault(interaction.user.id, []).append(now)
        await interaction.response.defer(ephemeral=True, thinking=True)
        who = interaction.user
        title, body = problem_issue_discord(
            getattr(who, 'display_name', '') or who.name, who.id,
            field_said(self.what), field_said(self.doing), field_said(self.server), now * 1000)
        try:
            number = await asyncio.get_running_loop().run_in_executor(
                None, github_file, title, body, PROBLEM_LABELS)
        except Exception as e:
            log('problems: a problem from Discord could not be filed:', e)
            await interaction.followup.send(
                'It could not be put on the board just now, so nothing was filed. Post it '
                'in this channel as a message instead and staff will read it.', ephemeral=True)
            return
        await interaction.followup.send(
            'It is on the board for the developers. Thank you.', ephemeral=True)
        await report_say('**%s reported a problem in Discord**, on the board as #%d.\n%s'
                         % (as_typed(getattr(who, 'display_name', '') or who.name, 40),
                            number, as_typed(field_said(self.what), 300)))


class ProblemPanel(discord.ui.View):
    """Persistent, like the ticket panel, so the button outlives a restart."""
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label='Report a problem', style=discord.ButtonStyle.primary,
                       custom_id='thornswood:problem')
    async def report(self, interaction, button):
        no = problem_refusal(interaction.user, time.time())
        if no:
            await interaction.response.send_message(no, ephemeral=True)
            return
        await interaction.response.send_modal(ProblemModal())


def problem_panel_is_current(msg):
    return (getattr(msg, 'content', None) == PROBLEM_PANEL and
            _rows(msg) == [['thornswood:problem']])


async def ensure_problem_panel(guild):
    """
    The panel in #test-findings, made once and edited when it changes.

    #test-findings is a forum, where a message stands only as a post, so the
    panel is a post of the bot's own, called Report a problem and pinned to
    the top. In a text channel (PROBLEM_CHANNEL set to one) it is a message.
    Found again by its button, never by its words, so a change of words is
    an edit and not a second panel.
    """
    ch = _channel_named(guild, PROBLEM_CHANNEL, ('text', 'forum'))
    if ch is None:
        log('there is no #%s in "%s", so there is no Report a problem panel. Set '
            'PROBLEM_CHANNEL in bot.env.json to the right channel.' % (PROBLEM_CHANNEL, guild.name))
        return
    try:
        if _kind(ch) == 'forum':
            for th in await _bot_threads(ch, client.user.id):
                try:
                    m = await th.fetch_message(th.id)
                except discord.NotFound:
                    continue
                if not (m.components and 'thornswood:problem' in _hold_ids(m)):
                    continue
                if not problem_panel_is_current(m):
                    await m.edit(content=PROBLEM_PANEL, view=ProblemPanel())
                    log('Report a problem panel updated in #%s' % ch.name)
                else:
                    log('Report a problem panel is already current in #%s' % ch.name)
                if getattr(th, 'archived', False) or not getattr(getattr(th, 'flags', None), 'pinned', False):
                    await th.edit(archived=False, pinned=True)
                return
            made = await ch.create_thread(name='Report a problem', content=PROBLEM_PANEL,
                                          view=ProblemPanel(),
                                          allowed_mentions=discord.AllowedMentions.none(),
                                          reason='Report a problem (#3155)')
            th = getattr(made, 'thread', made)
            await th.edit(pinned=True)
            log('Report a problem panel posted and pinned in #%s' % ch.name)
            return
        async for m in ch.history(limit=50):
            if (m.author.id == client.user.id and m.components and
                    'thornswood:problem' in _hold_ids(m)):
                if problem_panel_is_current(m):
                    log('Report a problem panel is already current in #%s' % ch.name)
                    return
                await m.edit(content=PROBLEM_PANEL, view=ProblemPanel())
                log('Report a problem panel updated in #%s' % ch.name)
                return
        await ch.send(PROBLEM_PANEL, view=ProblemPanel())
        log('Report a problem panel posted in #%s' % ch.name)
    except Exception:
        log('could not post the Report a problem panel in #%s:\n' % ch.name
            + traceback.format_exc())


# ------------------------------------------------------ staff in the world --
#
# What a moderator did in the game (#412): /kick, /freeze, /silence, /warn and
# the rest. The gamemode appends one JSON line per action to
# for-bot\moderation.log beside each game server, on this same box, and this
# says each new line once in the staff channel, so the record is outside the
# game and in front of the rest of staff. A file rather than a request, for the
# same reason as watch_trouble: no new secret, port or ticket.
#
# for-bot, not private (#2321): private is SYSTEM's and Administrators' alone,
# and a rule on one file in it could only be given once the gamemode had made
# the file, long after the install that gives it. Install-Bot.ps1 gives the
# bot's account read on the for-bot folder, which a file made later takes.
MODERATION_LOGS = [
    ('live', os.environ.get('MODERATION_LOG',
                            r'C:\Thornswood-Server\for-bot\moderation.log')),
    ('dev', os.environ.get('MODERATION_LOG_DEV',
                           r'C:\Thornswood-Server-Dev\for-bot\moderation.log')),
    # Bans and notes made on the hub, which the site writes beside
    # trouble.json. The game's own /ban and /note are in the two above.
    ('site', os.environ.get('MODERATION_LOG_SITE',
                            os.path.join(os.path.dirname(TROUBLE_FILE), 'moderation.log'))),
]
MODERATION_EVERY = _int_env('MODERATION_EVERY', 30)
# More than this in one look from one server is said as a count, not a wall.
MODERATION_AT_ONCE = 10

_MOD_DID = {
    'kick': 'removed %s from the world',
    'freeze': 'froze %s in place',
    'unfreeze': 'let %s move again',
    'bring': 'brought %s to them',
    'goto': 'went to %s',
    'silence': 'silenced %s',
    'unsilence': 'let %s speak again',
    'warn': 'warned %s',
    'give': 'gave %s',
    'spawn': 'spawned beside %s',
    'tp': 'sent %s',
    # One character, or the whole account, and a character killed for good (#1010).
    'ban': 'banned the character %s',
    'unban': 'lifted the ban on the character %s',
    'banaccount': 'banned the whole account of %s, every character on it',
    'unbanaccount': 'lifted the ban on the account of %s',
    'pk': 'killed %s for good (PK), quietly',
    # An admin undoing a PK made by mistake (#1010, 29 September).
    'unpk': 'undid the PK of %s, so the character can be played again',
    'note': 'wrote a note on %s',
    # Staff at a building's door, from the Office page of K (#2551, Patrick,
    # 17 Oct): the why names the building and its hold, and the rent set.
    'evict': 'ended the claim of %s',
    'rent': 'set the rent on the claim of %s',
    'norent': 'took the rent off the claim of %s',
    # Rent handed over in person, marked paid on the Office page (#3895).
    'rentpaid': 'marked rent paid by %s',
    # Staff on the world's card, the Office page of K (#513): the stage is
    # the who, and the why says from where, to where, and the force.
    'worldpropose': 'proposed moving the world to %s',
    'worldconfirm': 'confirmed moving the world to %s',
    'worlddrop': 'dropped the proposal to move the world to %s',
    # Staff on the crafting card, the Office page of K (#3167): the why says
    # which rank from what to what, or what was given back and why.
    'craftrank': 'raised a rank of %s',
    'craftrecipes': 'handed the newer recipe list to the game of %s',
    'craftgive': 'gave back to %s',
    # Not staff: somebody's own /stuck (#414), said as its why reads.
    'stuck': 'used /stuck',
    # Not staff either: the server took somebody idle out of the world (#1142).
    'idle': 'was moved out for being idle',
}


def moderation_text(where, row):
    """
    One line of moderation.log as the staff channel reads it, or None for a
    line that is not one. Names and reasons were typed in the game, so they
    are escaped: nothing in them can ping anybody or dress itself up.
    """
    if isinstance(row, dict) and row.get('did') in ('office', 'jarlclash', 'jarlclear'):
        return office_text(row)
    if not isinstance(row, dict) or row.get('did') not in _MOD_DID:
        return None

    clean = as_typed

    def person(name, pid):
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            pid = 0
        # The hub knows a person by account, not by profile.
        if pid <= 0:
            return clean(name, 40) or 'somebody'
        return '%s (profile %d)' % (clean(name, 40) or 'somebody', pid)

    # /stuck is not a staff action: the person did it to themselves, and the
    # gamemode writes the whole sentence (from where, to where, the account).
    if row['did'] == 'stuck':
        why = clean(row.get('why'), 600) or 'used /stuck.'
        return ('**/stuck on the %s server:** %s %s'
                % (where, person(row.get('byName'), row.get('by')), why))[:1900]

    # Moved out of the world for being idle (#1142): nobody did it to them, so
    # it reads as what happened and why, which the gamemode writes.
    if row['did'] == 'idle':
        why = clean(row.get('why'), 600) or 'nothing from their game for too long'
        return ('**Idle on the %s server:** %s was taken back to the character choice and put in line: %s'
                % (where, person(row.get('whoName'), row.get('who')), why))[:1900]

    did = _MOD_DID[row['did']] % person(row.get('whoName'), row.get('who'))
    try:
        minutes = int(row.get('minutes') or 0)
    except (TypeError, ValueError):
        minutes = 0
    if row['did'] == 'silence' and minutes > 0:
        did += ' for %d minute%s' % (minutes, '' if minutes == 1 else 's')
    why = clean(row.get('why'), 300)
    head = ('**Staff on the site:**' if where == 'site'
            else '**Staff on the %s server:**' % where)
    return ('%s %s %s%s'
            % (head, person(row.get('byName'), row.get('by')), did,
               (': ' + why) if why else '.'))[:1900]


def _moderation_lines(path):
    """
    (lines, why). lines is every whole line in one moderation.log, [] when
    there is no file yet (no staff action on that server so far), None when it
    could not be read, and then why says what refused it. A last line with no
    line ending is left for the next look, the same as _watch_log_lines.
    """
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except FileNotFoundError:
        return [], ''
    except Exception as e:
        return None, '%s: %s' % (type(e).__name__, e)
    parts = data.decode('utf-8-sig', errors='replace').split('\n')
    return [p.rstrip('\r') for p in parts[:-1] if p.strip()], ''


def _moderation_unreadable(unread, where, path, why):
    """
    Say in bot.log when one moderation.log cannot be read, and when it can be
    again, once each rather than every look (#2321). Until #2321 a refused
    read was skipped with nothing logged, so a server whose staff log the
    bot's account could not open said nothing anywhere.
    """
    if why and unread.get(where) != why:
        unread[where] = why
        log('moderation: cannot read %s (%s), so staff actions on %s are not '
            'said in the staff channel until it can be. Install-Bot.ps1 gives '
            'the bot\'s account read on that folder.'
            % (path, why, 'the site' if where == 'site' else 'the %s server' % where))
    elif not why and where in unread:
        del unread[where]
        log('moderation: %s can be read again' % path)


async def watch_moderation():
    """
    Say each new staff action from the game in the staff channel, once.

    The lines already in each file when this starts are treated as said, as in
    watch_trouble, or every restart of the bot would repeat the history. A
    file that cannot be read is skipped for that look rather than read as
    empty, and said in bot.log. Nothing in here may end the loop.
    """
    await client.wait_until_ready()
    loop = asyncio.get_running_loop()
    seen = {}
    unread = {}
    for where, path in MODERATION_LOGS:
        lines, why = await loop.run_in_executor(None, _moderation_lines, path)
        seen[where] = set(lines) if lines is not None else None
        _moderation_unreadable(unread, where, path, why)
    log('moderation: reading %s every %ds'
        % (', '.join(p for _, p in MODERATION_LOGS), MODERATION_EVERY))

    while not client.is_closed():
        try:
            for where, path in MODERATION_LOGS:
                lines, why = await loop.run_in_executor(None, _moderation_lines, path)
                _moderation_unreadable(unread, where, path, why)
                if lines is None:
                    continue
                if seen.get(where) is None:
                    seen[where] = set(lines)
                    continue
                new = [l for l in lines if l not in seen[where]]
                seen[where].update(new)
                texts = []
                for l in new:
                    try:
                        text = moderation_text(where, json.loads(l))
                    except ValueError:
                        text = None
                    if text:
                        texts.append(text)
                if len(texts) > MODERATION_AT_ONCE:
                    await report_say(
                        '**%d staff actions on %s** since the last look, more '
                        'than this channel should carry one at a time. They '
                        'are in %s on the VPS.'
                        % (len(texts),
                           'the site' if where == 'site' else 'the %s server' % where,
                           path))
                else:
                    for text in texts:
                        await report_say(text)
        except Exception:
            log('moderation: the check itself failed, carrying on:\n'
                + traceback.format_exc())
        await asyncio.sleep(MODERATION_EVERY)


# ------------------------------------------------------------- heartbeat --
# How the watchdog tells a running bot from a working one (issue #449).
#
# The watchdog on the VPS used to know one thing about the bot: whether a
# python process with Thornswood-Bot in its command line was alive. A bot
# stuck logging in, hung, or cut off from Discord and never getting back is
# still that process, so the one outage the bot exists to tell staff about,
# itself, looked fine. So this writes heartbeat.json beside this file every
# HEARTBEAT_EVERY seconds: its pid, when it started, when it wrote it,
# whether it is connected to Discord, when it last was, and when it last
# handled something Discord sent it and what. The watchdog reads it
# (BeatProblem in scripts\vps\Watch-Services.ps1) and treats ten quiet
# minutes of any of those as the bot being down while its process runs.
#
# It is written from its own loop, so a hung event loop stops it, which is
# the point. Written to a temporary file and renamed over the old one, so
# the watchdog never reads half of one.
HEARTBEAT_FILE = os.environ.get(
    'HEARTBEAT_FILE',
    os.path.join(DATA_DIR, 'heartbeat.json'))
HEARTBEAT_EVERY = _int_env('HEARTBEAT_EVERY', 60)

# The fields the watchdog reads. test-heartbeat.py checks the two agree.
_beat = {
    'pid': os.getpid(),
    'started': int(time.time()),
    'connected': False,
    'connected_at': 0,
    'last_event': 0,
    'last_event_type': '',
}
_beat_failed = False


def beat_record(now, closed=False):
    """What heartbeat.json says at unix time now. closed is the client having
       been closed, which no event says."""
    if closed:
        _beat['connected'] = False
    if _beat['connected']:
        _beat['connected_at'] = int(now)
    rec = dict(_beat)
    rec['written'] = int(now)
    return rec


def beat_write(rec, path=None):
    """Put rec in heartbeat.json. True when it is there. A failure is said in
       bot.log once, not every minute, and never stops the bot."""
    global _beat_failed
    path = path or HEARTBEAT_FILE
    tmp = path + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(rec, f)
        os.replace(tmp, path)
        _beat_failed = False
        return True
    except Exception:
        if not _beat_failed:
            log('could not write ' + path + ', so the watchdog cannot tell '
                'whether this bot is on Discord:\n' + traceback.format_exc())
        _beat_failed = True
        return False


def beat_now():
    return beat_write(beat_record(time.time(), client.is_closed()))


async def heartbeat():
    """Started once, in setup_hook. Runs until the process ends."""
    while True:
        beat_now()
        await asyncio.sleep(HEARTBEAT_EVERY)


def beat_connected(on):
    _beat['connected'] = bool(on)
    beat_now()


@client.event
async def on_connect():
    beat_connected(True)


@client.event
async def on_resumed():
    beat_connected(True)


@client.event
async def on_disconnect():
    beat_connected(False)


@client.event
async def on_socket_event_type(event_type):
    # Every event Discord sends, whether or not anything here handles it.
    # Kept in memory only; the loop above writes it.
    _beat['last_event'] = int(time.time())
    _beat['last_event_type'] = str(event_type)


# ----------------------------------------------------------- uptime ping --
# The heartbeat above is read on the box, by the watchdog, and a box that is
# off, frozen or cut off reads nothing and says nothing. So the bot also pings
# an outside monitor (Patrick, 29 Sep: "I want the bot too as well"): one GET
# to PING_URL every PING_EVERY seconds while it is on Discord. When the pings
# stop for longer than the monitor's grace, the monitor sends its alert,
# whether the bot hung, lost Discord or stopped, or the whole VPS went down,
# and whether or not One is on.
#
# PING_URL lives only in bot.env.json on the VPS, put there by
# .\scripts\deploy\Install-Bot.ps1 -SetPing on ssh's standard input. Whoever
# has it can keep the monitor quiet, so it is never logged, not even in an
# error. Each ping runs on a worker thread with its own timeout, so a slow or
# dead monitor never holds up anything Discord sends, and a ping still in
# flight is never doubled. It is sent from the event loop, so a hung bot stops
# pinging, which is the point. A failure is said once per outage and once
# when it works again; nothing here can stop the bot.
PING_URL = os.environ.get('PING_URL', '').strip()
PING_EVERY = _int_env('PING_EVERY', 60)
PING_TIMEOUT = _int_env('PING_TIMEOUT', 10)
# How often the loop looks, so the first ping follows connecting by seconds.
PING_LOOK = 5

_ping = {'down': False, 'ok_once': False}


def ping_shape_ok(url):
    """A web address, and nothing that could be a file or a command."""
    return (url.lower().startswith(('https://', 'http://'))
            and not any(c.isspace() for c in url))


def _ping_scrub(text, url):
    """text with the address, and its path, taken out."""
    text = str(text)
    for part in (url, url.split('://', 1)[-1]):
        if part:
            text = text.replace(part, 'the ping address')
    tail = url.split('://', 1)[-1].split('/', 1)
    if len(tail) == 2 and len(tail[1]) > 3:
        text = text.replace(tail[1], 'the ping address')
    return text


def ping_once(url, timeout=None):
    """One ping. True when the monitor answered 2xx. Never raises."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'thornswood-bot'})
        with urllib.request.urlopen(req, timeout=timeout or PING_TIMEOUT) as r:
            r.read(256)
            code = r.status
        ok = 200 <= code < 300
        why = 'it answered %d' % code
    except Exception as e:
        ok = False
        code = getattr(e, 'code', None)
        if isinstance(code, int):
            why = 'it answered %d' % code
        else:
            why = '%s: %s' % (type(e).__name__, getattr(e, 'reason', None) or e)
    # Only the log lines and the record of what was said, none of which
    # throws, so they sit outside the try (#2736).
    if ok:
        if _ping['down']:
            log('uptime ping: the outside monitor hears from this bot again')
        elif not _ping['ok_once']:
            log('uptime ping: reached the outside monitor, and pings it every '
                '%ds while on Discord' % PING_EVERY)
        _ping['down'] = False
        _ping['ok_once'] = True
    else:
        if not _ping['down']:
            log('uptime ping FAILED (%s). The outside monitor alerts if it '
                'hears nothing past its grace. Said once until it works '
                'again.' % _ping_scrub(why, url))
        _ping['down'] = True
    return ok


async def uptime_ping():
    """Started once, in setup_hook. Runs until the process ends, or returns
       at once when there is nothing to ping."""
    if not PING_URL:
        log('uptime ping: PING_URL is not set in bot.env.json, so no outside '
            'monitor hears from this bot. Install-Bot.ps1 -SetPing sets it.')
        return
    if not ping_shape_ok(PING_URL):
        log('uptime ping: PING_URL in bot.env.json is not a web address, so '
            'nothing is sent. Install-Bot.ps1 -SetPing sets it again.')
        return
    loop = asyncio.get_running_loop()
    inflight = None
    last = None
    while True:
        try:
            now = time.monotonic()
            if (_beat['connected'] and not client.is_closed()
                    and (inflight is None or inflight.done())
                    and (last is None or now - last >= PING_EVERY)):
                last = now
                inflight = loop.run_in_executor(None, ping_once, PING_URL)
        except Exception:
            log('uptime ping: could not start one, carrying on:\n'
                + _ping_scrub(traceback.format_exc(), PING_URL))
        await asyncio.sleep(PING_LOOK)


# on_ready fires again on every reconnect, and a second loop would double every
# message this ever sends.
_watching = False


# What was last registered with Discord, so a restart does not do it all
# again. Next to the code, because that folder is the bot's own and a deploy
# that replaces it is a deploy that may have changed the commands anyway.
STAMP = os.path.join(DATA_DIR, 'commands-synced.json')

# Set FORCE_COMMAND_SYNC=1 in bot.env.json to make the next start register them
# whatever the stamp says. For the case where Discord has them and this file
# does not, which is a deploy that landed on a fresh folder.
FORCE_SYNC = _int_env('FORCE_COMMAND_SYNC', 0)


def _children_of(command):
    """
    A group's subcommands, and nothing at all for a plain command.

    Read by attribute rather than by type, because the ready harness stands a
    counting object in for the tree and never imports a real Group.
    """
    got = getattr(command, 'commands', None)
    return list(got) if got else []


def _command_names():
    """
    Every name Discord has to be told about, sorted: the groups, and their
    children under them.

    THE SCHEME. A child is written under its parent with a space between
    them, the way a person types it in the picker: `live-smoke` is in the
    list, and so are `live-smoke report` and the rest. Nested groups go on the
    same way, `parent child grandchild`. The stamp still holds a sorted list
    of plain strings, so a stamp written before this reads back fine; it is
    missing every child, which is exactly why the next start syncs.

    WHY IT IS NOT THE TOP LEVEL ALONE. It was, and adding a subcommand to a
    group that was already registered left this list identical. `/live-smoke
    report` was merged and deployed, the start said "slash commands already
    registered", no sync went to Discord, and the picker kept offering the
    three subcommands it had. It took FORCE_COMMAND_SYNC to put it there. A
    child is a command as far as the picker is concerned, so it is a name
    here.
    """
    out = []

    def walk(commands, prefix):
        for c in commands:
            name = (prefix + ' ' + c.name) if prefix else c.name
            out.append(name)
            walk(_children_of(c), name)

    walk(tree.get_commands(), '')
    return sorted(out)


def _stamp_read():
    try:
        with open(STAMP) as f:
            d = json.load(f)
        return list(d.get('commands') or []), [int(x) for x in (d.get('guilds') or [])]
    except Exception:
        return [], []


def _stamp_write(names, guilds):
    try:
        with open(STAMP, 'w') as f:
            json.dump({'commands': names, 'guilds': sorted(guilds)}, f)
    except Exception:
        log('could not write ' + STAMP + ', so the commands will be registered '
            'again on the next start:\n' + traceback.format_exc())


async def register_commands():
    """
    Put the slash commands on every server, once, and not again until they
    change.

    A global sync can take an hour to reach everybody, and it reaches people
    unevenly while it does, which looks exactly like one person's Discord
    being broken. Copying the commands onto the server itself and syncing that
    is immediate and the same for everyone in it.

    Registering both, which is what this did first, puts the command in the
    picker twice: Discord lists the server copy and the global copy as two
    separate entries and there is no way to tell them apart. So the guild copy
    is the one kept, and the global list is emptied straight after. Clearing
    globals is done last because copy_global_to reads that same list, and
    clearing it first would copy nothing.

    WHY IT IS BEHIND A STAMP. This was three writes to Discord per reconnect,
    doing nothing new every time, and a sync is one of the calls Discord rate
    limits hardest. A reconnect is not a new set of commands; a deploy is. So
    the names that were registered are written down beside the code, and this
    runs when that list differs, when a server appears that is not in it, or
    when FORCE_COMMAND_SYNC says to. A rate limited sync used to write a
    traceback on an evening that was already going badly.
    """
    want = _command_names()
    had, done = _stamp_read()
    fresh = [g for g in client.guilds if g.id not in done]

    if want == had and not fresh and not FORCE_SYNC:
        log('slash commands already registered: %s' % (', '.join(want) or 'none'))
        return

    synced = list(done)
    for g in client.guilds:
        try:
            tree.copy_global_to(guild=g)
            await tree.sync(guild=g)
            if g.id not in synced:
                synced.append(g.id)
            log('registered in "%s": %s'
                % (g.name, ', '.join('/' + n for n in want) or 'nothing'))
        except Exception:
            # Named rather than said as "the commands", because which ones
            # they are is the first thing anybody asks when none appear.
            log('could not register %s in "%s", the buttons still work:\n'
                % (', '.join('/' + n for n in want), g.name)
                + traceback.format_exc())
    try:
        tree.clear_commands(guild=None)
        await tree.sync()
    except Exception:
        log('could not clear the global commands, so a command may appear '
            'twice in the picker:\n' + traceback.format_exc())

    _stamp_write(want, synced)


@client.event
async def on_ready():
    global _watching
    if not _watching:
        _watching = True
        asyncio.create_task(watch_trouble())
        asyncio.create_task(watch_services())
        asyncio.create_task(watch_reports())
        asyncio.create_task(watch_problems())
        asyncio.create_task(watch_moderation())
        asyncio.create_task(watch_known_issues())
        asyncio.create_task(watch_staff_notices())
        asyncio.create_task(watch_release_news())
        asyncio.create_task(watch_join_numbers())
        asyncio.create_task(watch_closed_tickets())
        asyncio.create_task(watch_lines())

    log('up as %s' % client.user)
    log('github: the issues of %s, with a %s token' % (KNOWN_REPO, github_token_kind()))

    await register_commands()

    for g in client.guilds:
        await ensure_panel(g)
        await ensure_hold_panel(g)
        await ensure_office_roles(g)
        await ensure_office_panel(g)
        await ensure_faction_panel(g)
        await ensure_problem_panel(g)
    log('watching %d server(s)' % len(client.guilds))
    # Guilds are known here. Empty was already said in setup_hook. IDs
    # that match no role can only be seen once the guild's roles are in.
    # Log only: do not post this to a channel.
    if UPPER_STAFF_IDS:
        warn_upper_staff_config(client.guilds)

    # Three separate things have to be true for a join card to appear, and
    # when one of them is not, the only symptom is silence. So check all three
    # at startup and say which one is wrong, by name.

    # One: Discord has to be sending joins at all.
    if not client.intents.members:
        log('member joins: OFF. No join cards will ever fire. Turn on Server '
            'Members Intent at discord.com/developers, Bot page, then restart.')
        return
    log('member joins: on')

    for g in client.guilds:
        # Two: the channel has to exist, and be a text channel.
        ch = by_name(g, [WELCOME])
        if ch is None:
            names = ', '.join('#' + c.name for c in g.text_channels) or 'none'
            log('there is no text channel called #%s in "%s", so join cards '
                'have nowhere to go. Text channels there: %s. Either make one '
                'with that name, or set JOIN_CHANNEL in bot.env.json on the '
                'VPS to one of those and run Install-Bot.ps1 again.'
                % (WELCOME, g.name, names))
            continue

        # Three: the bot has to be allowed to post, and to attach the card.
        p = ch.permissions_for(g.me)
        missing = [n for n, ok in (('View Channel', p.view_channel),
                                   ('Send Messages', p.send_messages),
                                   ('Attach Files', p.attach_files)) if not ok]
        if missing:
            log('cannot post in #%s in "%s": the bot is missing %s there. Fix '
                'it in that channel\'s permissions, or give the bot role those '
                'permissions server wide.' % (ch.name, g.name, ', '.join(missing)))
        else:
            log('join cards will go to #%s in "%s"' % (ch.name, g.name))


def run_cli(argv):
    """
    The by-hand jobs, on a connection of their own that starts none of the
    bot's watchers, panels or command sync, and closes when it is done:

      --setup-channels [--apply]   the one-time setup, a preview without --apply
      --post-task --title T --body B|--body-file F [--tag Main|Dev]
      --adopt-task --issue N --thread ID   (offline; with the bot stopped)
      --forum-check [--apply]      the duplicate posts in #known-issues,
                                   #test-tasks and #dev-test-tasks, a preview
                                   without --apply (forum_check)

    Returns the exit code.
    """
    import argparse
    ap = argparse.ArgumentParser(prog='bot.py')
    ap.add_argument('--env-file')
    ap.add_argument('--setup-channels', action='store_true')
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--post-task', action='store_true')
    ap.add_argument('--title')
    ap.add_argument('--body')
    ap.add_argument('--body-file')
    ap.add_argument('--tag', choices=list(HAND_TAGS), default=TASK_POST_TAG)
    ap.add_argument('--guild', type=int, default=0)
    ap.add_argument('--adopt-task', action='store_true')
    ap.add_argument('--issue', type=int)
    ap.add_argument('--thread', type=int)
    ap.add_argument('--forum-check', action='store_true')
    a = ap.parse_args(argv)
    if a.adopt_task:
        if not a.issue or not a.thread:
            ap.error('--adopt-task needs --issue and --thread')
        print(adopt_task(a.issue, a.thread))
        return 0
    if a.post_task:
        body = a.body
        if a.body_file:
            with open(a.body_file, encoding='utf-8-sig') as f:
                body = f.read()
        if not a.title or not body:
            ap.error('--post-task needs --title and --body or --body-file')
    out = {'code': 0}
    cli = TrustedClient(intents=discord.Intents(guilds=True))

    @cli.event
    async def on_ready():
        try:
            guilds = [g for g in cli.guilds if not a.guild or g.id == a.guild]
            if not guilds:
                print('the bot is in no server%s' % (
                    ' with id %d' % a.guild if a.guild else ''))
                out['code'] = 1
            for g in guilds:
                print('"%s" (%d):' % (g.name, g.id))
                if a.setup_channels:
                    for line in await channel_setup(g, apply=a.apply):
                        print('  ' + line)
                    if not a.apply:
                        print('  (preview only; add --apply to do it)')
                elif a.forum_check:
                    state = _state_read(KNOWN_STATE)
                    if state is None:
                        print('  %s will not read; nothing was looked at' % KNOWN_STATE)
                        out['code'] = 1
                        continue
                    recs = forum_records(state)
                    me = getattr(cli.user, 'id', None)
                    for forum, part in ((_channel_named(g, KNOWN_NAME, ('forum',)), 'known'),
                                        (_channel_named(g, TASKS_NAME, ('forum',)), 'tasks'),
                                        (dev_tasks_forum(g), 'dev')):
                        if forum is None:
                            print('  no %s forum' % part)
                            continue
                        for line in await forum_check(forum, recs[part], me, a.apply):
                            print('  ' + line)
                    if not a.apply:
                        print('  (preview only; add --apply to delete the duplicates)')
                else:
                    thread, said = await post_test_task(g, a.title, body, a.tag)
                    print('  ' + said)
                    if thread is None:
                        out['code'] = 1
        except Exception:
            traceback.print_exc()
            out['code'] = 1
        finally:
            await cli.close()

    cli.run(TOKEN, log_handler=None)
    return out['code']


# A deletion request, taken out of the bot's own records as it starts (#2758).
# Patrick, 18 Oct 2026, after the first real deletion on his own account: "it
# should not restart everytime we want to delete a person it should just fully
# apply the rest upon a server restart". scripts\vps\Delete-Person.ps1 stops
# nothing: it writes the request into deletion-requests.json in the bot's data
# folder,
#
#     {"people": [{"discordId": "111111111111111111", "profiles": [5001]}]}
#
# and this takes it out before the bot connects, so no click can write one of
# these files back while it goes: their join number (the last number given out
# stays in joins.json, so nobody is handed theirs again) and their open ticket.
# A file that is there and will not parse, or a write that does not take,
# leaves the request for the next start, and is said; running it again finds
# what is already gone gone. The log says counts and never an id.
DELETION_REQUESTS = os.path.join(DATA_DIR, 'deletion-requests.json')


def apply_deletion_requests():
    """Takes every request in deletion-requests.json out of joins.json and
       open-tickets.json, then deletes it. Returns the line it logged, or
       None when there was no request."""
    def said(m):
        line = 'deletion requests: ' + m
        log(line)
        return line
    if not os.path.exists(DELETION_REQUESTS):
        return None
    try:
        with open(DELETION_REQUESTS, encoding='utf-8-sig') as f:
            req = json.load(f)
        people = req.get('people') if isinstance(req, dict) else None
        ids = [str(p.get('discordId')) for p in people] if isinstance(people, list) and all(isinstance(p, dict) for p in people) else None
    except (OSError, ValueError) as e:
        return said('the request could not be read (%s), so nothing was removed and it is left as it is' % type(e).__name__)
    if not ids or not all(re.match(r'^\d{17,20}$', i) for i in ids):
        return said('the request is not a list of deletion requests, so nothing was removed and it is left as it is')
    try:
        joins = _joins_read()
        tickets = {}
        if os.path.exists(OPEN_TICKETS):
            with open(OPEN_TICKETS, encoding='utf-8-sig') as f:
                tickets = json.load(f)
            if not isinstance(tickets, dict):
                raise ValueError(OPEN_TICKETS + ' is not a JSON object')
    except (OSError, ValueError) as e:
        return said('the records could not be read (%s), so nothing was removed and the request waits for the next start' % type(e).__name__)
    numbers = marks = 0
    for g in joins.values():
        members = g.get('members') if isinstance(g, dict) else None
        if isinstance(members, dict):
            for i in ids:
                if i in members:
                    del members[i]
                    numbers += 1
        # And when they left (#2353), which is about them as much as the number.
        left = g.get('left') if isinstance(g, dict) else None
        if isinstance(left, dict):
            for i in ids:
                if i in left:
                    del left[i]
                    marks += 1
    gone = [k for k in tickets if k.split(':')[-1] in ids]
    for k in gone:
        del tickets[k]
    try:
        if numbers or marks:
            _joins_write(joins)
        if gone:
            tmp = OPEN_TICKETS + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(tickets, f)
            os.replace(tmp, OPEN_TICKETS)
    except OSError as e:
        return said('a record could not be written (%s), so the request waits for the next start' % type(e).__name__)
    what = '%d person(s): join numbers %d, open tickets %d' % (len(ids), numbers, len(gone))
    try:
        os.remove(DELETION_REQUESTS)
    except OSError as e:
        return said(what + '; the request could not be deleted (%s), so it runs again at the next start' % type(e).__name__)
    return said(what + '; done, and the request is gone')


# Under a main guard, so that importing this file reads it instead of running
# it. Without one, `import bot` connects to Discord with whatever token is in
# env, which is why nothing in here had ever been tested: there was no way to
# get at a function without starting a bot. Install-Bot.ps1 launches it as
# `python bot.py`, where __name__ is __main__, so this changes nothing about
# how it runs on the VPS.
if __name__ == '__main__':
    if ('--setup-channels' in sys.argv or '--post-task' in sys.argv
            or '--adopt-task' in sys.argv or '--forum-check' in sys.argv):
        raise SystemExit(run_cli(sys.argv[1:]))
    # Said here and not where the roots are written, so a tool that imports
    # bot.py reads nothing extra on its standard output.
    log('trusting %d root certificates from %s, leaving out %s' % (
        _trusted, ROOTS, ', '.join(_left_out) or 'none'))
    # One heartbeat before anything can hang, so a bot stuck logging in has
    # this run's pid in the file and the watchdog can say how long it has sat.
    beat_now()
    # Before it connects, so nothing it does can write a record back (#2758).
    apply_deletion_requests()
    try:
        client.run(TOKEN)
    except discord.PrivilegedIntentsRequired:
        log('Discord refused the connection because Server Members Intent is off.')
        log('Go to discord.com/developers, open the Thornswood application, Bot in')
        log('the left menu, switch on SERVER MEMBERS INTENT, save, then run')
        log('Install-Bot.ps1 again.')
        raise SystemExit(1)
    except discord.LoginFailure:
        log('Discord rejected the bot token. Reset it on the Bot page and run')
        log('Install-Bot.ps1 again to paste the new one.')
        raise SystemExit(1)
