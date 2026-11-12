"""
test-member-gate.py

The Member button in #start-here (#5841).

The plan gives Member from a button in #start-here once somebody says they
are 18 or over and accept the rules (Build-Discord.py, THE GATE,
q-3317-member-gate A). Until #5841 nothing in the bot made that button or
gave Member, so the 20 Members the audit of 12 Nov 2026 named all had it by
hand, and none had answered either question.

The real bot module is imported and its real button callbacks are run. Only
what touches Discord is replaced: the guild, the channel, the roles, the
interaction, and the push to the site.

Holds:
  the panel is posted once in #start-here, left alone when current, and
  edited in place when its words change
  bot.py registers it as a persistent view, and the ready step posts it
  two yeses give Member and send the rules answer to the site's record
  a no to either question gives nothing and sends nothing
  somebody who has Member already is told so and asked nothing
  a Member role the bot cannot give is said, not tried
  a -Posts build never deletes the panel as one of its doc posts

Read only. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341).
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import importlib.util
import types

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
os.environ.pop('MEMBER_ROLE', None)
os.environ.pop('MEMBER_GATE_CHANNEL', None)

import discord  # noqa: E402
import harness_bot  # noqa: E402
bot = harness_bot.whole()
import bot_member_gate as G  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


class Role(object):
    def __init__(self, name, rid, position):
        self.name = name
        self.id = rid
        self.position = position

    def __lt__(self, other):
        return self.position < other.position


class Person(object):
    def __init__(self, uid, name, roles=()):
        self.id = uid
        self.name = name
        self.display_name = name
        self.roles = list(roles)
        self.given = []

    async def add_roles(self, *roles, reason=None):
        self.given.extend(roles)
        self.roles.extend(roles)


class Response(object):
    def __init__(self):
        self.sent = []
        self.edited = []

    async def send_message(self, content=None, view=None, ephemeral=False):
        self.sent.append((content, view, ephemeral))

    async def edit_message(self, content=None, view=None):
        self.edited.append((content, view))


class Interaction(object):
    def __init__(self, guild, user):
        self.guild = guild
        self.user = user
        self.response = Response()


class Msg(object):
    def __init__(self, author, content, ids):
        self.author = author
        self.content = content
        self.components = ([types.SimpleNamespace(children=[
            types.SimpleNamespace(custom_id=i) for i in ids])] if ids else [])
        self.edits = []

    async def edit(self, content=None, view=None):
        self.edits.append(content)
        self.content = content


class Channel(object):
    def __init__(self, name, msgs=()):
        self.name = name
        self.msgs = list(msgs)
        self.sent = []

    def history(self, limit=50):
        msgs = list(self.msgs)

        async def gen():
            for m in msgs[:limit]:
                yield m
        return gen()

    async def send(self, content, view=None):
        self.sent.append((content, view))


ME = types.SimpleNamespace(id=999)
member_role = Role('Member', 1552485816859893830, 4)
top = Role('Thornswood', 1, 126)


def guild(roles=None, manage=True, channels=None):
    me = types.SimpleNamespace(guild_permissions=types.SimpleNamespace(manage_roles=manage),
                               top_role=top)
    return types.SimpleNamespace(roles=[member_role, top] if roles is None else roles,
                                 me=me, name='Thornswood',
                                 text_channels=channels or [], voice_channels=[])


PUSHED = []


async def fake_push(*a):
    PUSHED.append(a)

G.push_async = fake_push
G.client = types.SimpleNamespace(user=ME)
LOGS = []
G.log = lambda *a: LOGS.append(' '.join(str(x) for x in a))


def run(c):
    return asyncio.run(c)


def press(view, label):
    for item in view.children:
        if getattr(item, 'label', None) == label:
            return item
    raise AssertionError('no %s button' % label)


# ------------------------------------------------------------ the panel --
ch = Channel('start-here')
g = guild(channels=[ch])
run(G.ensure_member_gate(g))
yes('the panel is posted in #start-here when it is not there',
    len(ch.sent) == 1 and ch.sent[0][0] == G.GATE_PANEL
    and isinstance(ch.sent[0][1], G.MemberGatePanel))
view = ch.sent[0][1]
yes('  with one button, Get Member, that outlives a restart',
    [getattr(i, 'custom_id', None) for i in view.children] == [G.GATE_ID]
    and view.timeout is None)

ch = Channel('start-here', [Msg(ME, G.GATE_PANEL, [G.GATE_ID])])
run(G.ensure_member_gate(guild(channels=[ch])))
yes('a current panel is left alone', ch.sent == [] and ch.msgs[0].edits == [])

ch = Channel('start-here', [Msg(ME, 'old words', [G.GATE_ID])])
run(G.ensure_member_gate(guild(channels=[ch])))
yes('a panel with old words is edited in place, not posted twice',
    ch.sent == [] and ch.msgs[0].edits == [G.GATE_PANEL])

LOGS[:] = []
run(G.ensure_member_gate(guild(channels=[])))
yes('no #start-here is said in the log', any('no #start-here' in m for m in LOGS))

src = harness_bot.source()
yes('bot.py loads the module', 'import bot_member_gate' in open(
    os.path.join(HERE, 'bot.py'), encoding='utf-8').read())
yes('the panel is registered as a persistent view at start',
    'self.add_view(MemberGatePanel())' in src)
yes('and posted when the bot is ready', 'await ensure_member_gate(g)' in src)

# -------------------------------------------------------- two yeses --
def ask(person, g):
    """Press Get Member and return the first question's view."""
    it = Interaction(g, person)
    run(press(G.MemberGatePanel(), 'Get Member').callback(it))
    return it


PUSHED[:] = []
g = guild()
p = Person(11, 'Newcomer')
it = ask(p, g)
yes('Get Member asks the age question, only to the person who pressed',
    it.response.sent and it.response.sent[0][0] == G.AGE_ASK and it.response.sent[0][2] is True)
q1 = it.response.sent[0][1]
it2 = Interaction(g, p)
run(press(q1, 'Yes').callback(it2))
yes('a yes to it asks the rules question', it2.response.edited[0][0] == G.RULES_ASK)
q2 = it2.response.edited[0][1]
it3 = Interaction(g, p)
run(press(q2, 'Yes').callback(it3))
yes('a yes to both gives Member', p.given == [member_role]
    and it3.response.edited[0][0] == G.GIVEN)
yes('  and sends the rules answer to the site against their Discord id',
    len(PUSHED) == 1 and PUSHED[0][0] == 'member' and PUSHED[0][4] == 11
    and PUSHED[0][5] == {'said': G.rules_record('Newcomer')['said'], 'yes': True})

# ------------------------------------------------------------- a no --
for step, label in (('age', 'the age question'), ('rules', 'the rules question')):
    PUSHED[:] = []
    p = Person(12, 'Somebody')
    it = Interaction(g, p)
    run(press(G.Question(step), 'No').callback(it))
    yes('a no to %s gives nothing and sends nothing' % label,
        p.given == [] and PUSHED == [] and it.response.edited[0][1] is None
        and it.response.edited[0][0] == (G.UNDER_AGE if step == 'age' else G.NOT_RULES))

# ---------------------------------------------------- already Member --
PUSHED[:] = []
p = Person(13, 'Old hand', [member_role])
it = ask(p, g)
yes('somebody with Member already is told so and asked nothing',
    it.response.sent == [(G.ALREADY, None, True)] and PUSHED == [])

# ---------------------------------------------- a role it cannot give --
for what, gg in (('no Member role', guild(roles=[top])),
                 ('no Manage Roles', guild(manage=False)),
                 ('a Member role above its own',
                  guild(roles=[Role('Member', 5, 200), top]))):
    PUSHED[:] = []
    p = Person(14, 'Somebody')
    it = Interaction(gg, p)
    run(press(G.Question('rules'), 'Yes').callback(it))
    yes('with %s, Member is not tried and the person is told to ask staff' % what,
        p.given == [] and PUSHED == [] and it.response.edited[0][0] == G.CANNOT)

# ---------------------------------------- a -Posts build leaves it --
spec = importlib.util.spec_from_file_location(
    'build_discord_gate_test', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)
panel = Msg(ME, G.GATE_PANEL, [G.GATE_ID])
panel.type = discord.MessageType.default
words = Msg(ME, 'How to actually get in and play.', [])
words.type = discord.MessageType.default
yes('a -Posts build takes the panel for a panel, not one of its doc posts',
    not B.doc_post_of_mine(panel, ME.id) and B.doc_post_of_mine(words, ME.id))

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
