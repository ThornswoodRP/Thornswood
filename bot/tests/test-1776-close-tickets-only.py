"""
test-1776-close-tickets-only.py

/close and the Close ticket button close a ticket and nothing else (#1776).

close_here only asked whether it was used in a thread. Staff running /close
in a Live smoke session thread, a #tales post or any other thread archived
and locked it, and the bot wrote "Closed: <thread name>" with a link in the
staff ticket record as if it were a ticket. A ticket is a thread off a
channel named in TICKET_CHANNEL, the only place TicketModal opens one; a
ticket that could not have its thread goes into the TICKET_LOG channel as a
plain message, never a thread.

This runs the real /close command, the real Close ticket button and
close_here, as staff, in threads that are not tickets, and expects the
"only works inside a ticket" line to them alone, and nothing archived,
locked, said in the thread or written down. Then the same as staff in a
ticket under every TICKET_CHANNEL name, which still closes, archives, locks
and writes it down, so a gate that refuses everything does not pass.

The real bot module is imported. Only what touches Discord is replaced: the
interaction, the threads and their channels, and the staff channel the
record goes to.

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
bot.OPEN_TICKETS = os.path.join(tempfile.mkdtemp(prefix='thornswood-1776-'),
                                'open-tickets.json')

NOT_A_TICKET = 'This one only works inside a ticket.'


# ------------------------------------------------------------- the world --
class Role(object):
    def __init__(self, name, rid):
        self.name = name
        self.id = rid
        self.mention = '<@&%d>' % rid


class Person(object):
    def __init__(self, roles, uid=500):
        self.id = uid
        self.name = '+'.join(roles) or 'nobody'
        self.display_name = self.name
        self.mention = '<@%d>' % uid
        self.roles = [Role(r, 7000 + i) for i, r in enumerate(roles)]
        self.bot = False
        self.system = False


class Channel(object):
    """A text or forum channel a thread hangs off. Keeps what is posted."""
    def __init__(self, name):
        self.name = name
        self.sent = []

    async def send(self, *a, **k):
        self.sent.append(a)


class Thread(discord.Thread):
    """A real Thread, because close_here asks isinstance, off the parent
       given (None for one the bot has not cached)."""
    jump_url = 'https://discord.com/channels/1/2/3'

    def __init__(self, name, parent):
        self.name = name
        self._off = parent
        self.edited = []
        self.sent = []

    @property
    def parent(self):
        return self._off

    async def edit(self, **k):
        self.edited.append(k)

    async def send(self, *a, **k):
        self.sent.append(a)


class Answer(object):
    """interaction.response, counted."""
    def __init__(self):
        self.said = []

    async def send_message(self, text=None, ephemeral=False, **k):
        self.said.append((text, ephemeral))

    def is_done(self):
        return bool(self.said)


class Ask(object):
    def __init__(self, who, channel):
        self.user = who
        self.guild = object()
        self.channel = channel
        self.message = None
        self.response = Answer()
        self.followup = self.response


BOOK = []


class Book(object):
    """The staff channel a closed ticket is written down in."""
    async def send(self, *a, **k):
        BOOK.append(a)


async def staff_book(guild, make=True):
    return Book()


bot.log_channel = staff_book

STAFF = Person(['Moderator'])
yes('a Moderator is staff, so every refusal below is the ticket check and '
    'not the staff one', bot.is_staff(STAFF))


# ---------------------------------------------------- the ways to close --
async def by_command(ask):
    await bot.tree.get_command('close').callback(ask, why='Sorted out.')


async def by_button(ask):
    view = bot.TicketTools()
    button = [c for c in view.children
              if getattr(c, 'custom_id', None) == 'thornswood:close']
    await button[0].callback(ask)


async def by_close_here(ask):
    await bot.close_here(ask)


WAYS = [('/close', by_command), ('the Close ticket button', by_button),
        ('close_here', by_close_here)]
yes('/close is registered, and so is the Close ticket button',
    bot.tree.get_command('close') is not None)


def run(way, channel, who=STAFF):
    ask = Ask(who, channel)
    del BOOK[:]
    asyncio.run(way(ask))
    return ask


# ------------------------------------------------- 1. not a ticket, refused --
tasks = bot.TASKS_NAME
NOT_TICKETS = [
    ('a #test-tasks forum thread', lambda: Thread('Test the ferry', Channel(tasks))),
    ('a #tales post', lambda: Thread('The bandit at the bridge', Channel('tales'))),
    ('a thread in #general', lambda: Thread('anything', Channel('general'))),
    ('a thread off the staff ticket record channel (%s)' % bot.TICKET_LOG[0],
     lambda: Thread('a staff chat', Channel(bot.TICKET_LOG[0]))),
    ('a thread off a channel whose name only starts like a ticket channel',
     lambda: Thread('x', Channel(bot.TICKETS[0] + '-old'))),
    ('a thread whose parent the bot has not cached',
     lambda: Thread('x', None)),
]

for label, way in WAYS:
    for what, make in NOT_TICKETS:
        thread = make()
        ask = run(way, thread)
        said = ask.response.said
        yes('%s as staff in %s is refused with the ticket line, to them alone'
            % (label, what),
            len(said) == 1 and said[0][0] == NOT_A_TICKET and said[0][1] is True)
        yes('  and nothing is archived, locked, said in it or written down',
            not thread.edited and not thread.sent and not BOOK)

    plain = Channel(bot.TICKETS[0])
    ask = run(way, plain)
    yes('%s in the ticket channel itself, not a thread, is refused as before'
        % label,
        ask.response.said == [(NOT_A_TICKET, True)] and not plain.sent and not BOOK)

# Somebody who is not staff, in a thread that is not a ticket: refused, and
# with nothing done either way.
thread = Thread('Test the ferry', Channel(tasks))
ask = run(by_command, thread, Person(['Member'], uid=501))
yes('somebody who is not staff is refused in a thread that is not a ticket',
    len(ask.response.said) == 1 and ask.response.said[0][1] is True
    and not thread.edited and not BOOK)


# --------------------------------------------------- 2. a ticket, closed --
names = list(bot.TICKETS) + [bot.TICKETS[0].upper()]
yes('TICKET_CHANNEL names at least the panel channel (%s)' % ', '.join(bot.TICKETS),
    len(bot.TICKETS) >= 1)
for label, way in WAYS:
    for name in names:
        thread = Thread('Apply to be an alpha playtester, Dee', Channel(name))
        ask = run(way, thread)
        said = ask.response.said
        yes('%s as staff in a ticket off #%s closes it' % (label, name),
            len(said) == 1 and (said[0][0] or '').startswith('Closed by')
            and said[0][1] is False)
        yes('  archived and locked',
            len(thread.edited) == 1 and thread.edited[0].get('archived') is True
            and thread.edited[0].get('locked') is True)
        yes('  and written down once, with the link back to it',
            len(BOOK) == 1 and 'Closed: **Apply to be an alpha playtester, Dee**'
            in BOOK[0][0] and thread.jump_url in BOOK[0][0])

# Content Creator is pulled into creator applications and is not staff: in a
# real ticket they get the staff line, which shows the ticket check let the
# ticket through to the staff gate.
thread = Thread('Apply: Content Creator, Dee', Channel(bot.TICKETS[0]))
ask = run(by_command, thread, Person(['Content Creator'], uid=502))
yes('a Content Creator in a real ticket meets the staff gate, not the ticket one',
    len(ask.response.said) == 1 and 'Staff close these' in ask.response.said[0][0]
    and not thread.edited and not BOOK)


# ------------------------------------------------------------- the words --
yes('the refusal does not say player', 'player' not in NOT_A_TICKET.lower())

print('\n%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
