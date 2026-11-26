"""
forum-swap-cases.py

    python tests/forum-swap-cases.py

The cases tests/test-4492-forum-swap.js runs, which say why. Each prints a
PASS or FAIL line, and it exits 1 when any fails.

bot/Apply-Discord.py's ensure_channel, open_threads, refused and the check
the build's deletes share are lifted out of the file by their source and run
against a stand-in guild, with a stand-in for the few discord names they
use. So this needs neither discord.py nor a token, and runs wherever there
is a Python 3. Never connects to anything.
"""
import ast
import asyncio
import itertools
import os
import types

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(REPO, 'bot', 'Apply-Discord.py')
with open(BUILD, encoding='utf-8') as f:
    SRC = f.read()
TREE = ast.parse(SRC)

FAIL = []


def yes(what, cond):
    if not cond:
        FAIL.append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


def node_of(name):
    for node in TREE.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    return None


def lift(name):
    node = node_of(name)
    return ast.get_source_segment(SRC, node) if node is not None else ''


def called_in(node, callee):
    """Whether the function node calls callee by name anywhere in it."""
    for n in ast.walk(node):
        if isinstance(n, ast.Call):
            f = n.func
            if (isinstance(f, ast.Name) and f.id == callee) or \
               (isinstance(f, ast.Attribute) and f.attr == callee):
                return True
    return False


def functions_calling(attr):
    """Every top level function of Apply-Discord.py that calls .attr()."""
    return sorted(n.name for n in TREE.body
                  if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                  and called_in(n, attr))


# ---- a stand-in for the discord names the lifted code uses ----------------
class HTTPException(Exception):
    def __init__(self, status, text):
        Exception.__init__(self, text)
        self.status = status
        self.text = text
        self.code = 0
        self.response = types.SimpleNamespace(status=status, reason=text)


class Forbidden(HTTPException):
    pass


class ForumChannel(object):
    pass


class TextChannel(object):
    pass


DISCORD = types.SimpleNamespace(HTTPException=HTTPException, Forbidden=Forbidden,
                                ForumChannel=ForumChannel, TextChannel=TextChannel,
                                ChannelType=types.SimpleNamespace(news='news'))

_ids = itertools.count(9000)


class Category(object):
    def __init__(self, name):
        self.id = next(_ids)
        self.name = name


class _Channel(object):
    def __init__(self, guild, name, category, messages=0, topic=None):
        self.guild = guild
        self.id = next(_ids)
        self.name = name
        self.category = category
        self.topic = topic
        self.messages = ['message %d' % i for i in range(messages)]

    def history(self, limit=100, **kw):
        self.guild.calls.append(('history', self.name, limit))
        if self.guild.history_refused:
            raise HTTPException(403, 'Missing Access')
        msgs = self.messages if limit is None else self.messages[:limit]

        async def walk():
            for m in msgs:
                yield m
        return walk()

    async def delete(self, reason=None):
        self.guild.calls.append(('delete', self.name))
        if self.guild.delete_refused:
            raise HTTPException(403, 'Missing Permissions')
        self.guild.channels.remove(self)

    async def edit(self, **kw):
        self.topic = kw.get('topic', self.topic)


class Text(_Channel, TextChannel):
    pass


class Forum(_Channel, ForumChannel):
    pass


class Guild(object):
    def __init__(self, forum_refused=False, threads_refused=False,
                 history_refused=False, delete_refused=False):
        self.name = 'Stand-in'
        self.channels = []
        self.threads = []
        self.calls = []
        self.forum_refused = forum_refused
        self.threads_refused = threads_refused
        self.history_refused = history_refused
        self.delete_refused = delete_refused

    def text(self, name, category, messages=0):
        ch = Text(self, name, category, messages)
        self.channels.append(ch)
        return ch

    async def active_threads(self):
        self.calls.append(('active_threads',))
        if self.threads_refused:
            raise HTTPException(403, 'Missing Access')
        return list(self.threads)

    async def create_forum(self, name, category=None, topic=None, **kw):
        self.calls.append(('create_forum', name))
        if self.forum_refused:
            raise HTTPException(400, 'Community is not on')
        ch = Forum(self, name, category, topic=topic)
        self.channels.append(ch)
        return ch

    async def create_text_channel(self, name, category=None, topic=None, **kw):
        self.calls.append(('create_text_channel', name))
        ch = Text(self, name, category, topic=topic)
        self.channels.append(ch)
        return ch

    def changes(self):
        return [c for c in self.calls if c[0] in ('create_forum', 'create_text_channel', 'delete')]


# ---- the lifted build -----------------------------------------------------
SAID = []
space = {
    'discord': DISCORD,
    'say': lambda mark, what: SAID.append('%s %s' % (mark, what)),
    'made': [], 'kept': [], 'failed': [],
    'PRUNE': True, 'CHECK': False,
    'KEEP': ('kept-by-hand',),
    'spec_overwrites': lambda guild, spec, roles: {},
    'topic_text': lambda guild, spec: spec.get('topic'),
}


async def _no_bring_back(guild, cat, spec, want):
    return None


async def _no_overwrites(ch, ow, what):
    return None


space['bring_back'] = _no_bring_back
space['keep_overwrites'] = _no_overwrites

for name in ('refused', 'open_threads', 'why_kept', 'rebuild_as_forum', 'ensure_channel'):
    exec(lift(name), space)

yes('Apply-Discord.py has ensure_channel and open_threads, where the swap and '
    'the prune list\'s thread check are',
    'ensure_channel' in space and 'open_threads' in space)
yes('Apply-Discord.py has why_kept, the one check the build\'s deletes go through',
    'why_kept' in space)

CAT = Category('Out of Character')


def forum_spec(name):
    return dict(kind='forum', name=name, key=name.upper(), mode='open',
                topic='The %s forum.' % name)


def build(guild, name, check=False, prune=True):
    """One ensure_channel for a planned forum, as a -Prune build runs it."""
    space['PRUNE'] = prune
    space['CHECK'] = check
    for k in ('made', 'kept', 'failed'):
        del space[k][:]
    del SAID[:]
    found = {}
    try:
        got = asyncio.run(space['ensure_channel'](guild, CAT, forum_spec(name), {}, found))
    except Exception as e:  # what broke is the case's answer, and is printed
        print('      ensure_channel raised %s: %s' % (type(e).__name__, e))
        got = None
    return got, ' | '.join(SAID + space['failed'] + space['made'])


# ---- 1. an empty text channel is swapped, forum first --------------------
g = Guild()
old = g.text('bugs', CAT)
got, out = build(g, 'bugs')
yes('1 an empty #bugs, made as a text channel before Community, is rebuilt as a forum',
    isinstance(got, ForumChannel) and old not in g.channels
    and [c.name for c in g.channels] == ['bugs'])
yes('1   the forum is made before the text channel is deleted',
    g.changes() == [('create_forum', 'bugs'), ('delete', 'bugs')])
yes('1   and the build says it was rebuilt', 'rebuilt' in out and '#bugs' in out)

# ---- 2. a channel with messages is skipped and named ---------------------
g = Guild()
intro = g.text('character-introductions', CAT, messages=3)
got, out = build(g, 'character-introductions')
yes('2 #character-introductions, holding messages, is not deleted',
    intro in g.channels and ('delete', 'character-introductions') not in g.calls)
yes('2   and no forum is made beside it',
    ('create_forum', 'character-introductions') not in g.calls)
yes('2   and the build names it and says why: its messages',
    '#character-introductions' in out and 'message' in out)

# ---- 3. a channel with an open thread is skipped and named ---------------
g = Guild()
tales = g.text('tales', CAT)
g.threads = [types.SimpleNamespace(parent_id=tales.id)]
got, out = build(g, 'tales')
yes('3 #tales, with a thread still open in it and no message, is not deleted',
    tales in g.channels and ('delete', 'tales') not in g.calls
    and ('create_forum', 'tales') not in g.calls)
yes('3   and the build names it and says why: the open thread',
    '#tales' in out and 'thread' in out)

# ---- 4. a forum create that throws leaves the text channel ---------------
g = Guild(forum_refused=True)
bugs = g.text('bugs', CAT)
got, out = build(g, 'bugs')
yes('4 when Discord refuses the forum, #bugs is still there as it was',
    bugs in g.channels and ('delete', 'bugs') not in g.calls)
yes('4   and the build says the forum was not made, naming the channel',
    '#bugs' in ' | '.join(space['failed']) and 'forum' in ' | '.join(space['failed']))

# ---- 5. a delete refused after the forum was made ------------------------
g = Guild(delete_refused=True)
bugs = g.text('bugs', CAT)
got, out = build(g, 'bugs')
yes('5 when the old channel will not delete, the forum made stays and that is said',
    isinstance(got, ForumChannel) and bugs in g.channels
    and any('#bugs' in f for f in space['failed']))

# ---- 6. what Discord will not say is not taken as nothing ----------------
g = Guild(threads_refused=True)
bugs = g.text('bugs', CAT)
got, out = build(g, 'bugs')
yes('6 when Discord will not list the open threads, #bugs is not deleted',
    bugs in g.channels and ('delete', 'bugs') not in g.calls
    and ('create_forum', 'bugs') not in g.calls)
g = Guild(history_refused=True)
bugs = g.text('bugs', CAT)
got, out = build(g, 'bugs')
yes('6   nor when its messages cannot be read',
    bugs in g.channels and ('delete', 'bugs') not in g.calls
    and ('create_forum', 'bugs') not in g.calls and '#bugs' in out)

# ---- 7. -Check and no -Prune change nothing -------------------------------
g = Guild()
bugs = g.text('bugs', CAT)
got, out = build(g, 'bugs', check=True)
yes('7 -Prune -Check makes and deletes nothing, and says it would rebuild',
    g.changes() == [] and 'would rebuild' in out and bugs in g.channels)
g = Guild()
bugs = g.text('bugs', CAT)
got, out = build(g, 'bugs', prune=False)
yes('7 without -Prune nothing is made or deleted', g.changes() == [] and bugs in g.channels)
g = Guild()
mine = g.text('kept-by-hand', CAT)
got, out = build(g, 'kept-by-hand')
yes('7 a name in KEEP is never rebuilt', g.changes() == [] and mine in g.channels)

# ---- 8. one check, not a copy ---------------------------------------------
why = space.get('why_kept')
if why is not None:
    g = Guild()
    retired = g.text('tickets-and-applications', CAT, messages=5)
    yes('8 for the prune list, a channel the plan retired goes once no thread is '
        'open in it, whatever was written there (its messages are not looked at)',
        asyncio.run(why(retired, {})) is None)
    yes('8   a thread open in it keeps it, with the count',
        '2 thread' in (asyncio.run(why(retired, {retired.id: 2})) or ''))
    yes('8   and threads Discord would not list keep it too',
        bool(asyncio.run(why(retired, None))))
prune_list = node_of('on_ready')
swap = node_of('ensure_channel')
yes('8 the prune list (on_ready) and the forum swap (ensure_channel) both go '
    'through why_kept',
    prune_list is not None and swap is not None
    and called_in(prune_list, 'why_kept') and called_in(swap, 'why_kept'))
yes('8   and only open_threads asks Discord for the open threads',
    functions_calling('active_threads') == ['open_threads'])
readers = functions_calling('history')
yes('8   and the swap and the prune list read no messages themselves: why_kept does',
    'why_kept' in readers and 'ensure_channel' not in readers and 'on_ready' not in readers)

print('')
print('%d failed' % len(FAIL))
raise SystemExit(1 if FAIL else 0)
