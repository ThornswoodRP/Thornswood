"""
test-3317-ticket-desks.py

One channel a kind of ticket, each with a panel of its own (#3317).

Patrick, 22 Oct 2026: "remove the old tickets channel and than split the
tickets and applications -properly into a different category ... split into
moew than one channel seperate but why kinf of ticket". On the page he picked
two categories and five channels (q-3317-ticket-split, A): Tickets holds
#get-help and #report-someone, Applications holds #apply-to-playtest,
#apply-for-a-seat and #apply-for-staff. This proves:

  T1 every kind of ticket has exactly one desk, and Build-Discord.py's plan
     makes each desk, in Tickets or Applications, as a ticket channel
  T2 each desk's panel offers only its own kinds, under a custom_id of its
     own; the one panel of before still offers every kind
  T3 with the world open the playtest desk offers nothing and says so
  T4 a ticket opens off its own desk; on a server with no desk yet, off the
     one channel of before; never off the old channel once the desks are
     there
  T5 a thread off any desk, or off the old channel, is a ticket; another
     is not
  T6 ensure_panel puts each desk's panel up once and leaves it on a
     reconnect, and the old channel's panel loses its dropdown and says
     where the tickets went
  T7 the old channels are retired, KEEP no longer names #tickets, and
     -Prune leaves a channel while a thread is still open in it

bot.py and Build-Discord.py are imported for real. Never connects to
anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import contextlib
import importlib.util
import io
import itertools
import types

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
for _k in ('TICKET_CHANNEL', 'TICKET_LOG', 'THORNSWOOD_OPEN'):
    os.environ.pop(_k, None)

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


try:
    import discord
except ImportError:
    print('SKIP  discord.py is not installed here')
    print('')
    print('0 passed, 0 failed')
    sys.exit(0)

import bot  # noqa: E402

spec = importlib.util.spec_from_file_location(
    'build_discord', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)

SAID = []
bot.log = lambda *a: SAID.append(' '.join(str(x) for x in a))
_ids = itertools.count(5000)
DESKS = [d for d, _k in bot.TICKET_DESKS]

# ------------------------------------------------------------------ T1 --
every = [k for k, _l, _d in bot.KINDS_ALPHA]
owned = [k for _d, kinds in bot.TICKET_DESKS for k in kinds]
yes('T1 every kind of ticket has exactly one desk',
    sorted(every) == sorted(owned) and len(owned) == len(set(owned)))
yes('T1 the five desks Patrick picked, in his order',
    DESKS == ['get-help', 'report-someone', 'apply-to-playtest',
              'apply-for-a-seat', 'apply-for-staff'])
planned = dict((s['name'], (c, s)) for c, specs in B.PLAN for s in specs
               if s.get('key') in B.TICKET_KEYS)
yes('T1 the plan makes every desk, and no other ticket channel',
    sorted(planned) == sorted(DESKS))
yes('T1 help and reports are in Tickets, the applications in Applications',
    [planned[d][0] for d in DESKS] == ['Tickets', 'Tickets', 'Applications',
                                      'Applications', 'Applications'])
yes('T1 each desk is readable by everybody, and the bot can write in its threads',
    all(s['mode'] == 'read' and B.bot_needs(s) == B.TICKET_BOT_NEEDS
        for _c, s in planned.values()))
cats = [c for c, _ in B.PLAN]
yes('T1 Tickets sits right under Start Here; Applications after Roleplay Guide',
    cats.index('Tickets') == cats.index('Start Here') + 1
    and cats.index('Applications') == cats.index('Roleplay Guide') + 1)
yes('T1 #tickets-and-applications is in the plan no more',
    'tickets-and-applications' not in [s['name'] for _c, sp in B.PLAN for s in sp])

# ------------------------------------------------------------------ T2 --
bot.set_open(False)
for desk, kinds in bot.TICKET_DESKS:
    picker = bot.TicketPanel(desk).children
    yes('T2 #%s offers only %s' % (desk, ', '.join(kinds)),
        len(picker) == 1 and [o.value for o in picker[0].options] == list(kinds))
ids = [bot.TicketPanel(d).children[0].custom_id for d in DESKS]
yes('T2 each desk\'s dropdown has a custom_id of its own',
    len(set(ids)) == 5 and all(i == 'thornswood:ticket:' + d for i, d in zip(ids, DESKS)))
old = bot.TicketPanel().children[0]
yes('T2 the one panel of before keeps its custom_id and every kind',
    old.custom_id == 'thornswood:ticket'
    and [o.value for o in old.options] == every)
yes('T2 each desk has words of its own, none of them the old panel',
    len(set(bot.desk_panel(d) for d in DESKS)) == 5
    and bot.PANEL not in [bot.desk_panel(d) for d in DESKS])
yes('T2 the seat desk carries the staff rule; the playtest desk the age and rules',
    bot.STAFF_LEADERSHIP_RULE in bot.desk_panel('apply-for-a-seat')
    and '18 or over' in bot.desk_panel('apply-to-playtest'))

# ------------------------------------------------------------------ T3 --
bot.set_open(True)
yes('T3 open: the playtest desk offers nothing and says the world is open',
    not bot.TicketPanel('apply-to-playtest').children
    and 'Thornswood is open' in bot.desk_panel('apply-to-playtest'))
yes('T3   and every other desk is as it was',
    all(bot.TicketPanel(d).children for d in DESKS if d != 'apply-to-playtest'))
bot.set_open(False)


# ------------------------------------------------------------- stubs --
class Perm(object):
    def __init__(self, **kw):
        self.__dict__.update(kw)


class Message(object):
    def __init__(self, author, content, components):
        self.author = author
        self.content = content
        self.components = components
        self.edits = 0

    async def edit(self, content=None, view=None):
        self.edits += 1
        self.content = content
        self.components = _rows(view)


def _rows(view):
    if view is None or not view.children:
        return []
    return [types.SimpleNamespace(children=[types.SimpleNamespace(
        options=[types.SimpleNamespace(value=o.value, label=o.label)
                 for o in getattr(item, 'options', [])])
        for item in view.children])]


class Channel(object):
    def __init__(self, guild, name):
        self.guild = guild
        self.id = next(_ids)
        self.name = name
        self.mention = '<#%d>' % self.id
        self.messages = []
        self.category = None

    def permissions_for(self, who):
        return Perm(view_channel=True, send_messages=True,
                    create_private_threads=True, send_messages_in_threads=True,
                    use_application_commands=True)

    async def send(self, text=None, view=None, **kw):
        self.messages.append(Message(self.guild.me, text, _rows(view)))

    def history(self, limit=30):
        msgs = list(reversed(self.messages))

        async def walk():
            for m in msgs:
                yield m
        return walk()


class Guild(object):
    def __init__(self, names):
        self.id = next(_ids)
        self.name = 'Thornswood'
        self.me = types.SimpleNamespace(id=1, name='Thornswood')
        self.default_role = types.SimpleNamespace(id=self.id, name='@everyone')
        self.roles = []
        self.categories = []
        self.text_channels = [Channel(self, n) for n in names]

    def get(self, name):
        return [c for c in self.text_channels if c.name == name][0]


async def no_book(guild):
    return None


# ------------------------------------------------------------------ T4 --
both = Guild(DESKS + ['tickets-and-applications'])
for desk, kinds in bot.TICKET_DESKS:
    yes('T4 a %s ticket opens off #%s' % (kinds[0], desk),
        all(bot.ticket_channel(both, k) is both.get(desk) for k in kinds))
legacy = Guild(['tickets-and-applications'])
yes('T4 with no desk yet, every kind opens off #tickets-and-applications',
    all(bot.ticket_channel(legacy, k) is legacy.get('tickets-and-applications')
        for k in every))
part = Guild(['get-help', 'tickets-and-applications'])
yes('T4 once a desk is there, a kind whose desk is missing opens nowhere, '
    'not in the old channel',
    bot.ticket_channel(part, 'report') is None
    and bot.ticket_channel(part, 'help') is part.get('get-help'))

# ------------------------------------------------------------------ T5 --
class FakeThread(discord.Thread):
    def __init__(self, parent):
        self._parent = parent

    @property
    def parent(self):
        return self._parent


yes('T5 a thread off any desk is a ticket',
    all(bot.is_ticket_thread(FakeThread(both.get(d))) for d in DESKS))
yes('T5   and off the old channel, so one opened before the split can be closed',
    bot.is_ticket_thread(FakeThread(both.get('tickets-and-applications'))))
yes('T5   and a thread off any other channel is not',
    not bot.is_ticket_thread(FakeThread(Channel(both, 'tales'))))

# ------------------------------------------------------------------ T6 --
g = Guild(DESKS + ['tickets-and-applications'])
old = g.get('tickets-and-applications')
old.messages.append(Message(g.me, bot.PANEL, _rows(bot.TicketPanel())))
was_client, was_log = bot.client, bot.log_channel
bot.client = types.SimpleNamespace(user=g.me)
bot.log_channel = no_book
try:
    asyncio.run(bot.ensure_panel(g))
    first = dict((d, list(g.get(d).messages)) for d in DESKS)
    asyncio.run(bot.ensure_panel(g))     # a reconnect
finally:
    bot.client, bot.log_channel = was_client, was_log
yes('T6 each desk got its own panel, once, and a reconnect added none',
    all(len(g.get(d).messages) == 1 and g.get(d).messages[0].content == bot.desk_panel(d)
        for d in DESKS)
    and all(g.get(d).messages[0].edits == 0 for d in DESKS))
yes('T6   and each is current by panel_is_current',
    all(bot.panel_is_current(g.get(d).messages[0], d) for d in DESKS))
m = old.messages[0]
yes('T6 the old panel lost its dropdown and says where every desk is',
    not m.components and m.content.startswith(bot.MOVED_HEAD)
    and all(g.get(d).mention in m.content for d in DESKS))
yes('T6   and it was changed once, not again on the reconnect', m.edits == 1)

g2 = Guild(['tickets-and-applications'])
bot.client = types.SimpleNamespace(user=g2.me)
bot.log_channel = no_book
try:
    asyncio.run(bot.ensure_panel(g2))
finally:
    bot.client, bot.log_channel = was_client, was_log
yes('T6 a server not yet split gets the one panel of before, every kind',
    [x.content for x in g2.get('tickets-and-applications').messages] == [bot.PANEL])

bot.set_open(True)
g3 = Guild(DESKS)
bot.client = types.SimpleNamespace(user=g3.me)
bot.log_channel = no_book
try:
    asyncio.run(bot.ensure_panel(g3))
    asyncio.run(bot.ensure_panel(g3))
finally:
    bot.client, bot.log_channel = was_client, was_log
    bot.set_open(False)
play = g3.get('apply-to-playtest').messages
yes('T6 open: the playtest desk has its words alone, found again and not '
    'posted twice', len(play) == 1 and not play[0].components
    and play[0].content.startswith('**Apply to play**'))

# ------------------------------------------------------------------ T7 --
yes('T7 #tickets-and-applications and the old #tickets are retired',
    'tickets-and-applications' in B.RETIRED and 'tickets' in B.RETIRED)
yes('T7   and KEEP no longer saves #tickets; #ticket-log is still kept',
    'tickets' not in B.KEEP and 'ticket-log' in B.KEEP)


class PGuild(object):
    def __init__(self, threads):
        self._threads = threads

    async def active_threads(self):
        if self._threads is None:
            raise discord.HTTPException(types.SimpleNamespace(status=403, reason='no'),
                                        'Missing Access')
        return self._threads


busy = asyncio.run(B.open_threads(PGuild([types.SimpleNamespace(parent_id=77),
                                           types.SimpleNamespace(parent_id=77),
                                           types.SimpleNamespace(parent_id=9)])))
yes('T7 open threads are counted by the channel they are off',
    busy == {77: 2, 9: 1})
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    unknown = asyncio.run(B.open_threads(PGuild(None)))
yes('T7 when Discord will not list them, it is not taken as none open',
    unknown is None and 'could not be listed' in buf.getvalue())

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
