"""
test-staff-gate.py

Every staff and admin command the bot has, run as somebody who is not staff
for it, and refused (issue #1342).

The audit said some admin commands had no staff role check. Measured on
5 October, every command does have a gate: /close and the Close ticket button
answer to is_staff, and /test-task (the four /live-smoke commands until
11 October) to is_task_poster.
The hole was inside is_staff, which also let in anybody the channel trusted
with threads. On the server Build-Discord.py makes, that is Lead Gamemaster
and Trial Gamemaster, whose GM permissions carry Manage Threads on every
channel, and neither is a staff role. Both could close any ticket and skip
the ticket limits. Since #3317 every lead is on the council and staff; a
Trial Gamemaster still is not.

This holds all of it in place:

  1. Every slash command, context menu and persistent button the bot
     registers is listed below with the gate it answers to. One that is not
     listed, a new command or a new panel, fails here until it is written in
     with its gate.
  2. Every staff and admin one is run the way Discord runs it, through its
     checks and then its callback, as people who are not staff for it, and
     must answer with a refusal only that person sees and do nothing else.
  3. The same callbacks let the right people through, a staff role matched
     by its id after a rename included, so a gate that refuses everybody does
     not pass for a gate.

The real bot module is imported. Only what touches Discord is replaced: the
server, the channels, the ticket thread and the interaction, and the file of
open tickets, which is pointed at a temporary folder.

Read only. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import inspect
import re
import shutil
import tempfile

# bot.py refuses to load without one, and never uses it unless client.run is
# called, which nothing here does.
os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import discord  # noqa: E402

import bot  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


LOGGED = []
bot.log = lambda *a: LOGGED.append(' '.join(str(x) for x in a))
TMP = tempfile.mkdtemp(prefix='thornswood-staff-gate-')
bot.OPEN_TICKETS = os.path.join(TMP, 'open-tickets.json')


# ------------------------------------------------------------- the gates --
#
# Who may run what, as the Developer Guide (Q. Staff commands, In Discord) and
# bot/README.md say it. A command or a button that is not in here fails below.
STAFF = 'staff'                    # is_staff: STAFF_ROLES, by id or name
TASKS = 'test task poster'         # is_task_poster: TEST_TASK_ROLES
ANYBODY = 'anybody'                # somebody's own button, with its own limits
GATED = (STAFF, TASKS)

COMMANDS = {
    'close': STAFF,
    'test-task': TASKS,
}

# Persistent buttons and menus, by their custom_id. One ending in a colon is
# the start of a family of them.
BUTTONS = [
    ('thornswood:close', STAFF),       # Close ticket, on every ticket
    ('thornswood:ticket', ANYBODY),    # the ticket panel: one open, a cooldown
    ('thornswood:ticket:', ANYBODY),   # each ticket desk's panel (#3317), the same
    ('thornswood:hold:', ANYBODY),     # pick a hold: Member or staff, pick_hold
    ('thornswood:ping:', ANYBODY),     # ping roles: Member or staff, toggle_ping
    # A Jarl's office buttons (#2551): only the Jarl of a hold, for their own
    # hold, and nobody while two accounts hold that Jarl role: office_press
    # and office_change. bot/tests/test-2551-hold-offices.py presses them.
    ('thornswood:office:', ANYBODY),
    # A faction Leader's member buttons (#3317): only the Leader of a
    # faction, for their own faction, and nobody while two accounts hold
    # that Leader role: faction_press and faction_change.
    # bot/tests/test-3317-faction-panel.py presses them.
    ('thornswood:faction:', ANYBODY),
    # Report a problem in #test-findings (#3155): playtesters and staff, five
    # an hour each, problem_refusal. bot/tests/test-3155-problems.py holds it.
    ('thornswood:problem', ANYBODY),
]

# Staff: the council (Owner, Co-Owner and every lead, #3317, Patrick, 22 Oct)
# and the four ranks the Developer Guide listed before it, and the three who
# post a test task. Trial Gamemaster is not staff here.
STAFF_ROLES = ['Owner', 'Co-Owner', 'Lead Dev', 'Lead Gamemaster', 'Lead Loremaster',
               'Lead Moderator', 'Lead Content Creator', 'Lead Support',
               'Dev', 'Gamemaster', 'Moderator', 'Loremaster']
TASK_ROLES = ['Owner', 'Dev', 'Lead Gamemaster']
OUTSIDERS = {
    STAFF: [[], ['Member'], ['Playtester'], ['Content Creator'],
            ['Member', 'Content Creator'], ['Trial Gamemaster'],
            ['Server Booster'], ['Jarl of Whiterun'],
            ['Trading Company']],
    TASKS: [[], ['Member'], ['Playtester'], ['Content Creator'],
                 ['Trial Gamemaster'], ['Moderator'], ['Gamemaster'],
                 ['Loremaster']],
}

# Every role GM or ADMIN carries in Build-Discord.py has Manage Threads on
# every channel. Read from the builder, so this cannot drift from it.
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location(
    'build_discord', os.path.join(HERE, 'Build-Discord.py'))
_built = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_built)
MANAGES_THREADS = set(n for n, _c, _h, p in _built.ROLES
                      if p.manage_threads or p.administrator)

yes('the default staff in bot.py are the council and the four ranks',
    sorted(bot.STAFF_NAMES) == sorted(r.lower() for r in STAFF_ROLES))
yes('Trial Gamemaster carries Manage Threads, the way in this closes',
    'Trial Gamemaster' in MANAGES_THREADS)
yes('and is not a staff role, while every lead is',
    'trial gamemaster' not in bot.STAFF_NAMES and
    all(n.lower() in bot.STAFF_NAMES for n in _built.LEADS))


# ------------------------------------------------------------- the world --
ROLE_IDS = {}


class Role(object):
    def __init__(self, name, rid=None):
        if rid is None:
            rid = ROLE_IDS.setdefault(name, 7000 + len(ROLE_IDS))
        self.name = name
        self.id = rid
        self.mention = '<@&%d>' % rid


class Perms(object):
    def __init__(self, threads):
        self.manage_threads = threads

    def __getattr__(self, _name):
        return False


class Person(object):
    def __init__(self, roles, uid=500):
        self.id = uid
        self.name = '+'.join(r if isinstance(r, str) else r.name
                             for r in roles) or 'nobody'
        self.display_name = self.name
        self.mention = '<@%d>' % uid
        self.roles = [Role(r) if isinstance(r, str) else r for r in roles]
        self.bot = False
        self.system = False

    def __str__(self):
        return self.name


class Ticket(discord.Thread):
    """A ticket thread. A real Thread, because close_here asks isinstance."""
    jump_url = 'https://discord.com/channels/1/2/3'

    def __init__(self):
        self.name = 'apply-somebody'
        self.edited = []
        self.sent = []

    def permissions_for(self, who):
        # What discord.py answers for a thread is its parent channel's
        # permissions, and GM and ADMIN give Manage Threads on every channel.
        return Perms(any(r.name in MANAGES_THREADS for r in who.roles))

    async def edit(self, **k):
        self.edited.append(k)

    async def send(self, *a, **k):
        self.sent.append(a)


class Posted(object):
    """A text channel that keeps what was posted in it."""
    def __init__(self, name):
        self.name = name
        self.sent = []
        self.threads = []

    def permissions_for(self, who):
        return Perms(any(r.name in MANAGES_THREADS for r in who.roles))

    async def send(self, *a, **k):
        self.sent.append(a)

    async def history(self, limit=50, oldest_first=False):
        for m in []:
            yield m


# A ticket thread hangs off the channel the panel opens them in, which is
# what close_here asks before anything else (#1776).
Ticket.parent = Posted(bot.TICKETS[0])


class Server(object):
    def __init__(self, channels=()):
        self.id = 1
        self.name = 'Thornswood'
        self.roles = [Role(n) for n, _c, _h, _p in _built.ROLES]
        self.text_channels = list(channels)
        self.threads = {}
        self.me = Person([], uid=1)
        self.me.bot = True

    def get_thread(self, tid):
        return self.threads.get(tid)


class Answer(object):
    """interaction.response and interaction.followup, counted."""
    def __init__(self):
        self.said = []
        self.deferred = 0
        self.edited = []
        self.modals = []

    async def send_message(self, text=None, ephemeral=False, **k):
        self.said.append((text, ephemeral))

    async def send(self, text=None, ephemeral=False, **k):
        self.said.append((text, ephemeral))

    async def defer(self, ephemeral=False, thinking=False):
        self.deferred += 1

    async def edit_message(self, content=None, **k):
        self.edited.append(content)

    async def send_modal(self, modal):
        self.modals.append(modal)

    def is_done(self):
        return bool(self.said or self.deferred or self.edited or self.modals)


class Ask(object):
    def __init__(self, who, guild, channel):
        self.user = who
        self.guild = guild
        self.channel = channel
        self.message = None
        self.response = Answer()
        self.followup = self.response


BOOK = []


class Book(object):
    """The staff channel a closed ticket is written down in."""
    async def send(self, *a, **k):
        BOOK.append(a)


async def _book(guild, make=True):
    return Book()


bot.log_channel = _book


# ----------------------------------------------------- 1. the whole list --
def registered():
    """Every command a person can pick, by the name the picker shows."""
    out = {}

    def walk(commands, prefix):
        for c in commands:
            name = (prefix + ' ' + c.name) if prefix else c.name
            kids = bot._children_of(c)
            if kids:
                walk(kids, name)
            else:
                out[name] = c

    for kind in (discord.AppCommandType.chat_input,
                 discord.AppCommandType.user,
                 discord.AppCommandType.message):
        walk(bot.tree.get_commands(type=kind), '')
    return out


LEAVES = registered()
unknown = sorted(set(LEAVES) - set(COMMANDS))
yes('every command the bot registers has its gate written down here%s'
    % ('; not yet: ' + ', '.join('/' + n for n in unknown) if unknown else ''),
    not unknown)
gone = sorted(set(COMMANDS) - set(LEAVES))
yes('and every command written down here is still registered%s'
    % ('; gone: ' + ', '.join('/' + n for n in gone) if gone else ''),
    not gone)

hook = inspect.getsource(bot.Thornswood.setup_hook)
VIEWS = re.findall(r'add_view\((\w+)\((?:desk)?\)\)', hook)
yes('setup_hook registers the ticket panel and each ticket desk\'s (#3317), the '
    'ticket tools, the hold panel, the office panel (#2551), the faction panel '
    '(#3317), Report a problem (#3155) and no other panel (the Live smoke rows are gone)',
    sorted(VIEWS) == ['FactionPanel', 'HoldPanel', 'OfficePanel', 'ProblemPanel',
                      'TicketPanel', 'TicketPanel', 'TicketTools']
    and 'live_smoke' not in hook
    and hook.count('add_view(') == len(VIEWS))


def gate_of(custom_id):
    for start, gate in BUTTONS:
        if custom_id == start or (start.endswith(':')
                                  and custom_id.startswith(start)):
            return gate
    return None


async def every_button():
    views = [getattr(bot, n)() for n in VIEWS]
    out = []
    for v in views:
        for item in v.children:
            cid = getattr(item, 'custom_id', None)
            if cid:
                out.append((cid, item))
    return out


ITEMS = asyncio.run(every_button())
loose = sorted(set(c for c, _ in ITEMS if gate_of(c) is None))
yes('every button and menu the bot keeps has its gate written down here%s'
    % ('; not yet: ' + ', '.join(loose) if loose else ''), not loose)
yes('and the Close ticket button is among them, so the list was really read',
    any(c == 'thornswood:close' for c, _ in ITEMS))


# --------------------------------------------- 2. not staff, not served --
async def run_command(cmd, ask):
    """What Discord does with a slash command: its checks, then its callback.
       True when a check refused it before the callback ran."""
    try:
        if not await cmd._check_can_run(ask):
            return True
    except discord.app_commands.CheckFailure:
        return True
    args = dict((p.name, 'x') for p in cmd.parameters if p.required)
    await cmd.callback(ask, **args)
    return False


def entry_points():
    """(label, gate, how to run it) for every gated command and button."""
    out = []
    for name in sorted(COMMANDS):
        if COMMANDS[name] in GATED and name in LEAVES:
            cmd = LEAVES[name]
            out.append(('/' + name, COMMANDS[name],
                        (lambda c: lambda ask: run_command(c, ask))(cmd)))
    for cid, item in ITEMS:
        gate = gate_of(cid)
        if gate in GATED:
            async def press(ask, item=item):
                await item.callback(ask)
                return False
            out.append(('the %s button' % cid, gate, press))
    return out


def world():
    ticket = Ticket()
    tasks = Posted(bot.TASKS_NAME)
    guild = Server([tasks])
    return guild, ticket, tasks


def refusal_for(gate, guild, label=''):
    if gate == STAFF:
        return 'Staff close these'
    return 'post test tasks'


POINTS = entry_points()
yes('/close, the Close ticket button and /test-task are what this runs',
    sorted(l for l, _, _ in POINTS) == sorted(
        ['/close', '/test-task', 'the thornswood:close button']))

for label, gate, run in POINTS:
    for roles in OUTSIDERS[gate]:
        guild, ticket, tasks = world()
        channel = ticket if gate == STAFF else tasks
        who = Person(roles)
        ask = Ask(who, guild, channel)
        del BOOK[:]
        by_check = asyncio.run(run(ask))
        said = ask.response.said
        want = refusal_for(gate, guild, label)
        quiet = (not ticket.edited and not ticket.sent and not tasks.sent
                 and not BOOK and not ask.response.deferred
                 and not ask.response.edited and not ask.response.modals)
        told = by_check or (len(said) == 1 and said[0][1] is True
                            and want in (said[0][0] or ''))
        yes('%s refuses %s, says so to them alone, and does nothing'
            % (label, who.name), told and quiet)

# The two this issue was about, said by name.
guild, ticket, tasks = world()
trial = Person(['Trial Gamemaster'])
yes('a Trial Gamemaster does hold Manage Threads on the ticket',
    ticket.permissions_for(trial).manage_threads)
yes('and is still not staff', not bot.is_staff(trial))
yes('a Lead Gamemaster is staff, on the council (#3317)', bot.is_staff(
    Person(['Lead Gamemaster'])))
yes('is_staff reads roles and never a channel permission',
    'permissions_for' not in inspect.getsource(bot.is_staff)
    and list(inspect.signature(bot.is_staff).parameters) == ['who'])

# The ticket limits, which staff skip and nobody else does.
for roles in (['Trial Gamemaster'], ['Content Creator']):
    guild, _t, panel = world()
    who = Person(roles, uid=600)
    bot._last_ticket[bot._ticket_key(guild, who)] = bot._now()
    no = bot.ticket_refusal(Ask(who, guild, panel))
    yes('%s who has just sent a ticket waits out the cooldown like anybody'
        % who.name, bool(no) and 'only just sent a ticket' in no)


# ------------------------------------------------- 3. staff are served --
def close_as(who):
    guild, ticket, tasks = world()
    ask = Ask(who, guild, ticket)
    del BOOK[:]
    asyncio.run(LEAVES['close'].callback(ask, why=None))
    return ask, ticket


for name in STAFF_ROLES:
    ask, ticket = close_as(Person([name]))
    yes('%s closes a ticket: archived, locked and written down' % name,
        ask.response.said and ask.response.said[0][0].startswith('Closed by')
        and ticket.edited and ticket.edited[0].get('archived')
        and ticket.edited[0].get('locked') and len(BOOK) == 1)

for name in TASK_ROLES:
    # No test-tasks forum and no dev-test-tasks forum, so nothing is posted.
    # Main is the default tag; Dev goes to #dev-test-tasks (Patrick, 12 Oct).
    for tag, want in ((None, 'is not a forum yet'), ('Dev', 'is not made yet')):
        guild = Server()
        ask = Ask(Person([name]), guild, Posted('general'))
        kw = {} if tag is None else {'tag': tag}
        asyncio.run(LEAVES['test-task'].callback(ask, title='x', body='x', **kw))
        yes('%s gets past the test task gate (%s)' % (name, tag or 'Main'),
            ask.response.said and want in ask.response.said[-1][0])

for roles in (['Moderator'], ['Owner']):
    guild, _t, panel = world()
    who = Person(roles, uid=601)
    bot._last_ticket[bot._ticket_key(guild, who)] = bot._now()
    yes('%s skips the ticket cooldown, as staff do' % who.name,
        bot.ticket_refusal(Ask(who, guild, panel)) is None)

# By id, as #1355 has STAFF_ROLES set on the VPS. A renamed staff role still
# closes; a role that only borrows a staff name does not.
saved = (bot.STAFF_IDS, bot.STAFF_NAMES)
try:
    bot.STAFF_IDS, bot.STAFF_NAMES = {ROLE_IDS['Moderator']}, set()
    ask, ticket = close_as(Person([Role('Wardens', ROLE_IDS['Moderator'])]))
    yes('a staff role renamed in Discord still closes, matched by its id',
        ask.response.said and ask.response.said[0][0].startswith('Closed by')
        and ticket.edited)
    ask, ticket = close_as(Person([Role('Moderator', 9999)]))
    yes('a role that only carries a staff name does not, once ids are set',
        ask.response.said and 'Staff close these' in ask.response.said[0][0]
        and not ticket.edited)
finally:
    bot.STAFF_IDS, bot.STAFF_NAMES = saved

# Somebody whose roles cannot be read is refused, never let through.


class Unreadable(Person):
    @property
    def roles(self):
        raise RuntimeError('no roles today')

    @roles.setter
    def roles(self, _v):
        pass


yes('somebody whose roles cannot be read is not staff',
    bot.is_staff(Unreadable([])) is False)

shutil.rmtree(TMP, ignore_errors=True)
print('\n%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
