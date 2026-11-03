"""
The bot's settings from env, its Discord client, and what every part uses:
the log, escaping, pushing to the site, finding channels.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import json
import os
import traceback
import urllib.request

import discord

from bot_base import DATA_DIR, TrustedClient


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
        # At login, once bot.py has imported every part: they all import
        # this module, so what it starts is imported here, not at the top.
        import bot_ticket_panels
        from bot_tickets import TicketTools
        from bot_ticket_panels import TicketPanel, desk_kinds, set_open, site_open
        from bot_heartbeat import heartbeat
        from bot_uptime import uptime_ping
        from bot_holds import HoldPanel
        from bot_offices import OfficePanel
        from bot_factions import FactionPanel
        from bot_problems import ProblemPanel
        # First, so a site that is slow to answer below cannot delay it.
        asyncio.create_task(heartbeat())      # for the watchdog, #449
        asyncio.create_task(uptime_ping())    # for the outside monitor, #449
        # The one switch (#428), before the panel is built from KINDS.
        set_open(await asyncio.get_running_loop().run_in_executor(None, site_open))
        log('the world is %s' % ('open to everybody' if bot_ticket_panels.OPEN else 'in alpha, open by application'))
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
