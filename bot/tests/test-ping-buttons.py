"""
test-ping-buttons.py

The News and Updates ping buttons are in #welcome, every Member can press
them, News Pings is pinged in #news, and every bot holds Clanker.

Patrick, 12 Nov 2026, of the buttons under the holds in #choose-your-hold:
"those buttons don't fit well there and also aren't IC nor about choosing a
hold so maybe in #welcome", and the words over them did not match what goes
in #news and #updates. #choose-your-hold opens only to Playtesters and staff,
so a Member who read #news and #updates could not ask for a ping, and nothing
in the bot ever pinged News Pings: bot_news.py posted with every mention off.
The same day: "add a role called Clanker and make it be one that stands out
and include Paetreon, Thornswood, Jukebox, and Dishboard".

So this checks:

  P  the ping buttons are a panel of their own, in #welcome, with words that
     say what #news and #updates get; the hold panel has none; the bot
     registers the panel and puts it up at its start
  W  Member, Playtester and staff may press them; somebody with no role is
     told how to get Member and given nothing; a press gives the role and a
     second takes it off
  S  the bot's start posts the panel in #welcome when it is not there,
     rewrites one with old words, and leaves a current one alone; the
     build's -Posts run never deletes a message with buttons
  N  a post in #news pings News Pings and nobody else; a post in the dev
     channel pings nobody
  C  Clanker is in the plan, shown apart, under staff and above the rest,
     with no permissions; a build gives it to every bot and to nobody else,
     and -Check gives nothing

bot.py and Build-Discord.py are imported for real. Every guild, member and
message is a stand-in. Never connects to anything.
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
import inspect
import io
import itertools
import types

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
for _k in ('PING_CHANNEL', 'MEMBER_ROLE', 'STAFF_ROLES'):
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

import harness_bot  # noqa: E402

bot = harness_bot.whole()
P = sys.modules['bot_pings']
H = sys.modules['bot_holds']
N = sys.modules['bot_news']
_ids = itertools.count(7000)
SAID = []
P.log = lambda *a: SAID.append(' '.join(str(x) for x in a))


class Role(object):
    def __init__(self, name, position=1):
        self.id = next(_ids)
        self.name = name
        self.position = position
        self.mention = '<@&%d>' % self.id

    def __lt__(self, other):
        return self.position < other.position

    def __repr__(self):
        return '<role %s>' % self.name


class Person(object):
    def __init__(self, name, roles=(), is_bot=False):
        self.id = next(_ids)
        self.name = self.display_name = name
        self.roles = list(roles)
        self.bot = is_bot
        self.given = []

    async def add_roles(self, role, reason=None):
        self.roles.append(role)
        self.given.append(role.name)

    async def remove_roles(self, role, reason=None):
        self.roles.remove(role)


ROLES = dict((n, Role(n)) for n in ('Member', 'Playtester', 'Support', 'News Pings',
                                     'Updates Pings'))
TOP = Role('Thornswood', 200)


class Message(object):
    def __init__(self, author_id, content, ids):
        self.author = types.SimpleNamespace(id=author_id)
        self.content = content
        self.components = ([types.SimpleNamespace(children=[
            types.SimpleNamespace(custom_id=i) for i in ids])] if ids else [])
        self.edits = 0

    async def edit(self, content=None, view=None):
        self.content = content
        self.components = [types.SimpleNamespace(children=[
            types.SimpleNamespace(custom_id=i.custom_id) for i in view.children])]
        self.edits += 1


class Channel(object):
    def __init__(self, name, messages=()):
        self.name = name
        self.messages = list(messages)
        self.sent = []

    def history(self, limit=50):
        msgs = list(self.messages)

        async def gen():
            for m in msgs:
                yield m
        return gen()

    async def send(self, content=None, view=None, **kw):
        self.sent.append(content)
        m = Message(ME, content, [i.custom_id for i in view.children] if view else [])
        self.messages.insert(0, m)
        return m


ME = 1


def guild_with(welcome):
    g = types.SimpleNamespace(
        name='Thornswood', roles=list(ROLES.values()) + [TOP],
        me=types.SimpleNamespace(top_role=TOP,
                                 guild_permissions=types.SimpleNamespace(manage_roles=True)),
        text_channels=[welcome])
    return g


def run(coro):
    return asyncio.run(coro)


# ------------------------------------------------------------------ P --
panel = P.PingPanel()
yes('P the ping buttons are a panel of their own: News pings and Updates pings',
    [c.custom_id for c in panel.children] == ['thornswood:ping:news', 'thornswood:ping:updates']
    and [c.label for c in panel.children] == ['News pings', 'Updates pings'])
yes('P they go in #welcome', P.PING_CHANNEL == ['welcome'])
yes('P the words say what #news and #updates get: changes to the live server, and a '
    'warning before the live game server restarts',
    '#news' in P.PING_PANEL and 'live server' in P.PING_PANEL
    and '#updates' in P.PING_PANEL and 'restarts' in P.PING_PANEL)
yes('P the hold panel has no ping button and no word of pings',
    not any(i.startswith('thornswood:ping:') for i in H._hold_ids_wanted())
    and 'ping' not in H.HOLD_PANEL.lower())
hook = inspect.getsource(bot.Thornswood.setup_hook)
ready = open(os.path.join(HERE, 'bot_ready.py'), encoding='utf-8').read()
yes('P the bot registers the panel so the buttons outlive a restart, and puts it up at '
    'its start', 'add_view(PingPanel())' in hook and 'await ensure_ping_panel(g)' in ready)

# ------------------------------------------------------------------ W --
yes('W a Member may press them', P.may_ping(Person('m', [ROLES['Member']])))
yes('W a Playtester without Member may press them', P.may_ping(Person('t', [ROLES['Playtester']])))
yes('W Support may press them', P.may_ping(Person('s', [ROLES['Support']])))
yes('W somebody with no role may not', not P.may_ping(Person('n')))


class Interaction(object):
    def __init__(self, guild, user):
        self.guild = guild
        self.user = user
        self.said = []
        self.response = types.SimpleNamespace(send_message=self._send)

    async def _send(self, text, ephemeral=False):
        self.said.append((text, ephemeral))


g = guild_with(Channel('welcome'))
nobody = Person('n')
i = Interaction(g, nobody)
run(P.toggle_ping(i, 'News Pings'))
yes('W somebody with no role is told to react to the rules for Member, and given nothing',
    not nobody.roles and '#rules' in i.said[0][0] and i.said[0][1])
m = Person('m', [ROLES['Member']])
run(P.toggle_ping(Interaction(g, m), 'News Pings'))
yes('W a press gives a Member News Pings', ROLES['News Pings'] in m.roles)
run(P.toggle_ping(Interaction(g, m), 'News Pings'))
yes('W a second press takes it off', ROLES['News Pings'] not in m.roles)

# ------------------------------------------------------------------ S --
P.client = types.SimpleNamespace(user=types.SimpleNamespace(id=ME))
P.by_name = lambda guild, names, kind='text': next(
    (c for c in guild.text_channels if c.name in names), None)
w = Channel('welcome', [Message(ME, 'the welcome words', [])])
g = guild_with(w)
run(P.ensure_ping_panel(g))
yes('S a start with no panel in #welcome posts one, and leaves the welcome words alone',
    w.sent == [P.PING_PANEL] and len(w.messages) == 2)
run(P.ensure_ping_panel(g))
yes('S a second start finds it current and posts nothing', w.sent == [P.PING_PANEL])
old = Message(ME, '**Pings**\n\nold words', ['thornswood:ping:news', 'thornswood:ping:updates'])
w2 = Channel('welcome', [old])
run(P.ensure_ping_panel(guild_with(w2)))
yes('S one with old words is rewritten in place', old.edits == 1
    and old.content == P.PING_PANEL and not w2.sent)

spec = importlib.util.spec_from_file_location('build_discord_pings',
                                              os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)
mine = types.SimpleNamespace(author=types.SimpleNamespace(id=ME), content=P.PING_PANEL,
                             type=discord.MessageType.default,
                             components=old.components)
words = types.SimpleNamespace(author=types.SimpleNamespace(id=ME), content='the welcome words',
                              type=discord.MessageType.default, components=[])
yes('S the build\'s -Posts never deletes the panel, and still replaces the words',
    not B.doc_post_of_mine(mine, ME) and B.doc_post_of_mine(words, ME))

# ------------------------------------------------------------------ N --


class NewsChannel(object):
    def __init__(self, guild):
        self.guild = guild
        self.sends = []

    async def send(self, content=None, embed=None, allowed_mentions=None):
        self.sends.append((content, allowed_mentions))
        return types.SimpleNamespace(id=1)


news_ch = NewsChannel(types.SimpleNamespace(roles=list(ROLES.values())))
dev_ch = NewsChannel(types.SimpleNamespace(roles=list(ROLES.values())))
N.MAIN_NEWS_ID, N.DEV_NEWS_ID = 11, 22
N.client = types.SimpleNamespace(get_channel=lambda cid: {11: news_ch, 22: dev_ch}.get(cid))
parts = dict(title='t', description='d', color=1, author='a', footer='f', at=None)
run(N._news_send('main', parts, set()))
run(N._news_send('dev', parts, set()))
content, allowed = news_ch.sends[0]
yes('N a post in #news pings News Pings, and only that role',
    content == ROLES['News Pings'].mention and allowed.roles == [ROLES['News Pings']]
    and allowed.everyone is False and allowed.users is False)
yes('N a post in the dev channel pings nobody',
    dev_ch.sends[0][0] is None and dev_ch.sends[0][1].roles is False)

# ------------------------------------------------------------------ C --
names = [n for n, _c, _h, _p in B.ROLES]
row = dict((n, (c, h, p)) for n, c, h, p in B.ROLES)['Clanker']
yes('C Clanker is in the plan, shown apart, with no permissions, and a colour no other '
    'role has', row[1] is True and row[2].value == 0
    and [c for _n, c, _h, _p in B.ROLES].count(row[0]) == 1)
yes('C it sits under every staff role and above the Jarls, Patreon and Playtester',
    names.index('Clanker') == names.index('Support') + 1
    and names.index('Clanker') < names.index('Patreon') < names.index('Playtester'))

clanker = Role('Clanker')
bots = [Person('Thornswood', is_bot=True), Person('Patreon', is_bot=True),
        Person('Jockie Music', is_bot=True), Person('DISBOARD.org', is_bot=True,
                                                    roles=[clanker])]
people = [Person('Patrick', [ROLES['Member']]), Person('new')]
gb = types.SimpleNamespace(members=bots + people)


def quiet(coro):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        asyncio.run(coro)
    return buf.getvalue()


B.CHECK = True
B.failed = []
said = quiet(B.give_bots_clanker(gb, clanker))
yes('C -Check says which bots it would give it to and gives nothing',
    'would give' in said and not any(b.given for b in bots))
B.CHECK = False
quiet(B.give_bots_clanker(gb, clanker))
yes('C a build gives it to every bot that has not got it',
    all(clanker in b.roles for b in bots) and [b.given for b in bots]
    == [['Clanker'], ['Clanker'], ['Clanker'], []])
yes('C and to nobody else', not any(clanker in p.roles for p in people))
src = open(os.path.join(HERE, 'Build-Discord.py'), encoding='utf-8').read()
yes('C ensure_roles does it once the roles are in order',
    'await give_bots_clanker(guild, out.get(CLANKER))' in src)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
