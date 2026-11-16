"""
test-4227-backfill-unreadable.py

Issue #4227. backfill.py works out who already has a "came up the road"
card by reading the welcome and general channels. A channel whose history
could not be read was said and skipped, so the cards in it were not counted,
and with --go the people they belong to were posted a second public card,
mention and all. And on_ready caught every failure and the script exited 0.

The real backfill.py is imported (with discord.Client.run stood down, as
test-join-scripts.py does) and its real work() run against a stand-in
server:

  A  #welcome-travelers holds Ash's card and can be read; #general-chat holds
     Daggerio's card and refuses to be read, as a channel the bot lost Read
     Message History in does. With --go nothing is posted at all, not to
     Daggerio and not to VENUS, who has no card either, since who has one is
     not known; what it says names #general-chat; and the run is a failure,
     exit 1.
  B  the same with the dry run: nothing is posted, the channel is named, and
     it is a failure, rather than a list that leaves out the cards it could
     not read.
  C  both channels readable: Daggerio's card is counted and he gets no
     second one, VENUS gets hers, and the run exits 0.
  D  a failure that escapes work() makes on_ready's run a failure too, and
     the script's main hands exit_code() to SystemExit.

Never connects to anything.
"""
import os
import sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import datetime
import io
import shutil
import tempfile

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import discord  # noqa: E402

import harness_bot  # noqa: E402

bot = harness_bot.whole()
import card  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


STARTED = []
keep_run = discord.Client.run
discord.Client.run = lambda self, *a, **k: STARTED.append(1)
try:
    import backfill  # noqa: E402
finally:
    discord.Client.run = keep_run
yes('S1 importing backfill.py does not start a client', not STARTED)

UTC = datetime.timezone.utc
T0 = datetime.datetime(2026, 9, 20, 12, 0, tzinfo=UTC)
BOT_ID = 999


def at(hours):
    return T0 + datetime.timedelta(hours=hours)


class Avatar(object):
    def replace(self, **_k):
        return self

    async def read(self):
        return b'an avatar'


class Someone(object):
    def __init__(self, uid):
        self.id = uid


class Member(object):
    def __init__(self, uid, name, joined):
        self.id = uid
        self.name = name
        self.display_name = name
        self.joined_at = joined
        self.bot = False
        self.mention = '<@%d>' % uid
        self.display_avatar = Avatar()

    def __str__(self):
        return self.name


class Card(object):
    def __init__(self, who, created):
        self.author = Someone(BOT_ID)
        self.content = '%s came up the road.' % who.mention
        self.mentions = [who]
        self.created_at = created


class NoHistory(Exception):
    """What Discord raises for a channel the bot may not read the history of."""


class Channel(object):
    def __init__(self, name, messages, readable=True):
        self.name = name
        self.messages = messages
        self.readable = readable
        self.sent = []

    async def history(self, limit=None):
        if not self.readable:
            raise NoHistory('403 Forbidden (error code: 50001): Missing Access')
        for m in sorted(self.messages, key=lambda m: m.created_at, reverse=True):
            yield m

    async def send(self, content=None, file=None, **_k):
        self.sent.append(content)


class Guild(object):
    def __init__(self, members, channels):
        self.id = 1001
        self.name = 'Thornswood'
        self.member_count = len(members)
        self.me = Someone(BOT_ID)
        self.text_channels = channels
        self.members = members

    async def fetch_members(self, limit=None):
        for m in self.members:
            yield m


class Client(object):
    def __init__(self, guild):
        self.guilds = [guild]
        self.closed = 0

    async def close(self):
        self.closed += 1


ASH = Member(10, 'Ash', at(0))
DAGG = Member(11, 'Daggerio', at(1))
VENUS = Member(12, 'VENUS', at(2))


def world(general_readable):
    welcome = Channel(backfill.WELCOME, [Card(ASH, at(0.5))])
    general = Channel('general-chat', [Card(DAGG, at(1.5))], readable=general_readable)
    return Guild([ASH, DAGG, VENUS], [welcome, general]), welcome, general


def fake_render(name, data, number=None, line=None, alt=None):
    return io.BytesIO(b'a card')


async def no_sleep(*_a, **_k):
    return None


def run(guild, go, step=None):
    """backfill's real work() (or on_ready, with step) against this server.
       Returns every line it said and its exit code, or None when it has no
       exit_code to give."""
    said = []
    keep = dict(client=backfill.client, GO=backfill.GO, say=backfill.say)
    keep_render, keep_sleep = card.render, asyncio.sleep
    if isinstance(getattr(backfill, 'FAILED', None), list):
        del backfill.FAILED[:]
    backfill.client = Client(guild)
    backfill.GO = go
    backfill.say = lambda *a: said.append(' '.join(str(x) for x in a))
    card.render = fake_render
    asyncio.sleep = no_sleep
    try:
        asyncio.run((step or backfill.work)())
    finally:
        asyncio.sleep = keep_sleep
        card.render = keep_render
        for k, v in keep.items():
            setattr(backfill, k, v)
    code = backfill.exit_code() if callable(getattr(backfill, 'exit_code', None)) else None
    return said, code


TMP = tempfile.mkdtemp(prefix='ts-4227-')
keep_joins = bot.JOINS
try:
    # No record here, so every number is by join order; the numbers are not
    # what this is about.
    bot.JOINS = os.path.join(TMP, 'joins.json')

    g, welcome, general = world(general_readable=False)
    said, code = run(g, True)
    yes('A1 with #general-chat unreadable, --go posts nothing (posted %r)'
        % (welcome.sent,), welcome.sent == [] and general.sent == [])
    yes('A1 so Daggerio, whose card is in #general-chat, gets no second one',
        not any(DAGG.mention in (s or '') for s in welcome.sent))
    named = [s for s in said if '#general-chat' in s]
    yes('A2 and it names #general-chat (%s)' % ' | '.join(named), bool(named))
    yes('A2 and says nothing was posted', any('nothing' in s and 'posted' in s for s in named))
    yes('A3 and the run is a failure, exit 1 (got %r)' % (code,), code == 1)

    g, welcome, general = world(general_readable=False)
    said, code = run(g, False)
    yes('B1 the dry run posts nothing and names #general-chat',
        welcome.sent == [] and any('#general-chat' in s for s in said))
    yes('B1 and lists nobody as owed, since who has a card is not known',
        not any(s.startswith('owed:') for s in said))
    yes('B2 and is a failure too, exit 1 (got %r)' % (code,), code == 1)

    g, welcome, general = world(general_readable=True)
    said, code = run(g, True)
    yes('C1 with both readable, Daggerio\'s card in #general-chat is counted '
        'and he gets no second one (posted %r)' % (welcome.sent,),
        not any(DAGG.mention in (s or '') for s in welcome.sent))
    yes('C1 and VENUS, who has none, gets hers',
        welcome.sent == ['%s came up the road.' % VENUS.mention])
    yes('C2 and that run exits 0 (got %r)' % (code,), code == 0)

    async def broken():
        raise RuntimeError('the gateway went away')
    keep_work = backfill.work
    backfill.work = broken
    try:
        g, welcome, general = world(general_readable=True)
        said, code = run(g, True, step=backfill.on_ready)
    finally:
        backfill.work = keep_work
    yes('D1 a failure out of work() makes the run exit 1 (got %r)' % (code,), code == 1)
    with open(os.path.join(HERE, 'backfill.py'), encoding='utf-8') as f:
        src = f.read()
    main = src[src.find("if __name__ == '__main__':"):]
    yes('D2 the script\'s main hands exit_code() to SystemExit after the client stops',
        'client.run(' in main and 'SystemExit(exit_code())' in main
        and main.find('SystemExit(exit_code())') > main.find('client.run('))
finally:
    bot.JOINS = keep_joins
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
