"""
post-send-cases.py

    python tests/post-send-cases.py

The cases tests/test-4493-post-send.js runs, which say why. Each prints a
PASS or FAIL line, and it exits 1 when any fails.

bot/Build-Discord.py's post, write_posts, doc_post_of_mine and refused are
lifted out of the file by their source and run against a stand-in channel
that can refuse a send, with a stand-in for the few discord names they use.
So this needs neither discord.py nor a token, and runs wherever there is a
Python 3. Never connects to anything.
"""
import ast
import asyncio
import itertools
import os
import types

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(REPO, 'bot', 'Build-Discord.py')
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


def constant(name):
    for node in TREE.body:
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return ast.literal_eval(node.value)
    return None


# ---- a stand-in for the discord names the lifted code uses ----------------
class HTTPException(Exception):
    def __init__(self, status, text):
        Exception.__init__(self, text)
        self.status = status
        self.text = text
        self.code = 0
        self.response = types.SimpleNamespace(status=status, reason=text)


class NotFound(HTTPException):
    pass


class Forbidden(HTTPException):
    pass


MessageType = types.SimpleNamespace(default='default', reply='reply', pins_add='pins_add',
                                    thread_created='thread_created')
DISCORD = types.SimpleNamespace(HTTPException=HTTPException, NotFound=NotFound,
                                Forbidden=Forbidden, MessageType=MessageType)

ME = 77
SOMEONE = 12
_ids = itertools.count(5000)


class Msg(object):
    def __init__(self, channel, author, content, kind='default'):
        self.id = next(_ids)
        self.channel = channel
        self.author = types.SimpleNamespace(id=author)
        self.content = content
        self.type = kind
        self.components = []
        self.pinned = False

    async def delete(self):
        ch = self.channel
        ch.calls.append(('delete', self.content[:20]))
        if ch.delete_refused:
            raise Forbidden(403, 'Missing Permissions')
        if self not in ch.messages:
            raise NotFound(404, 'Unknown Message')
        ch.messages.remove(self)

    async def pin(self):
        self.pinned = True


class Channel(object):
    """A read only channel. refuse_send is the 1-based send Discord refuses
       (0: none); refuse_sends_from refuses that one and every one after."""
    def __init__(self, name, refuse_send=0, refuse_sends_from=0,
                 history_refused=False, delete_refused=False):
        self.name = name
        self.mention = '<#%s>' % name
        self.messages = []
        self.calls = []
        self.sends = 0
        self.refuse_send = refuse_send
        self.refuse_sends_from = refuse_sends_from
        self.history_refused = history_refused
        self.delete_refused = delete_refused

    def put(self, author, content, kind='default'):
        m = Msg(self, author, content, kind)
        self.messages.append(m)
        return m

    def history(self, limit=100, **kw):
        self.calls.append(('history',))
        if self.history_refused:
            raise Forbidden(403, 'Missing Access')
        msgs = list(reversed(self.messages))  # newest first, as Discord gives them
        msgs = msgs if limit is None else msgs[:limit]

        async def walk():
            for m in msgs:
                yield m
        return walk()

    async def send(self, content):
        self.sends += 1
        self.calls.append(('send', self.sends))
        if self.sends == self.refuse_send or (self.refuse_sends_from and self.sends >= self.refuse_sends_from):
            raise HTTPException(500, 'Internal Server Error')
        return self.put(ME, content)

    def mine(self):
        return [m.content for m in self.messages if m.author.id == ME and m.type == 'default']


# ---- the lifted build -----------------------------------------------------
SAID = []
GATE = constant('RULES_GATE_FIRST_LINE') or '**React here for the Member role**'
space = {
    'discord': DISCORD,
    'client': types.SimpleNamespace(user=types.SimpleNamespace(id=ME)),
    'say': lambda mark, what: SAID.append('%s %s' % (mark, what)),
    'failed': [], 'made': [], 'kept': [],
    'RULES_GATE_FIRST_LINE': GATE,
    'CHECK': False, 'POSTS': True,
    'C': types.SimpleNamespace(DRAFTS=()),
    'doc_with_footer': lambda key, thread=None: TEXTS[key],
}


async def _no_changelog(ch, key):
    return None


space['keep_changelog'] = _no_changelog

for name in ('refused', 'doc_post_of_mine', 'post', 'write_posts'):
    exec(lift(name), space)

yes('Build-Discord.py has post and write_posts, the step that writes a read only channel\'s words',
    'post' in space and 'write_posts' in space)

# Two paragraphs over 1,900 characters: post() sends them as two messages.
PARA_A = 'The first rule. ' + 'a' * 1000
PARA_B = 'The second rule. ' + 'b' * 1000
TEXTS = {'RULES': PARA_A + '\n\n' + PARA_B, 'GUIDE': 'How to join. Press Play.'}
NEW = [PARA_A, PARA_B]


def channel(name, **kw):
    ch = Channel(name, **kw)
    ch.put(SOMEONE, 'a person said hello')
    ch.put(ME, GATE + ' and react below')
    ch.put(ME, 'The old first rule.')
    ch.put(ME, 'The old second rule.')
    return ch


OLD = ['The old first rule.', 'The old second rule.']


def run(coro):
    """Runs one step of the build. A failure that escapes it is the case's
       answer: the build's run would stop there."""
    for k in ('failed', 'made', 'kept'):
        del space[k][:]
    del SAID[:]
    try:
        asyncio.run(coro)
        return None
    except Exception as e:
        print('      it raised %s: %s' % (type(e).__name__, e))
        return e


def failed():
    return ' | '.join(space['failed'])


# ---- 1. every send goes through -------------------------------------------
ch = channel('rules')
raised = run(space['post'](ch, TEXTS['RULES'], {}))
yes('1 with every send taken, #rules holds the new words and none of the old',
    raised is None and [c for c in ch.mine() if not c.startswith(GATE)] == NEW)
yes('1   the new words are sent before the old ones are taken down',
    [c[0] for c in ch.calls if c[0] in ('send', 'delete')] == ['send', 'send', 'delete', 'delete'])
yes('1   a person\'s message and the Member reaction post are left alone',
    'a person said hello' in [m.content for m in ch.messages]
    and any(m.content.startswith(GATE) for m in ch.messages))
yes('1   and the first new post is pinned', any(m.pinned and m.content == PARA_A for m in ch.messages))

# ---- 2. the second send is refused -----------------------------------------
ch = channel('rules', refuse_send=2)
raised = run(space['post'](ch, TEXTS['RULES'], {}))
yes('2 when Discord refuses the second send, the step does not stop the build', raised is None)
yes('2   #rules still holds its old words, whole',
    [c for c in ch.mine() if not c.startswith(GATE)] == OLD)
yes('2   and not half of the new ones beside them',
    PARA_A not in ch.mine())
yes('2   and the run says #rules was not rewritten, and why',
    '#rules' in failed() and 'not rewritten' in failed() and 'Internal Server Error' in failed())

# ---- 3. the first send is refused ------------------------------------------
ch = channel('rules', refuse_send=1)
raised = run(space['post'](ch, TEXTS['RULES'], {}))
yes('3 when Discord refuses the first send, #rules still holds its old words and nothing new',
    raised is None and [c for c in ch.mine() if not c.startswith(GATE)] == OLD and '#rules' in failed())

# ---- 4. a half-written send that cannot be taken back is said ---------------
ch = channel('rules', refuse_send=2)
ch.delete_refused = True
raised = run(space['post'](ch, TEXTS['RULES'], {}))
yes('4 when the half sent cannot be taken back either, the old words stay and the run names both',
    raised is None and OLD == [c for c in ch.mine() if c in OLD]
    and failed().count('#rules') >= 2)

# ---- 5. the old posts cannot be read ---------------------------------------
ch = channel('rules', history_refused=True)
raised = run(space['post'](ch, TEXTS['RULES'], {}))
yes('5 when the old posts cannot be read, nothing is sent and #rules is named (#2736)',
    raised is None and ch.sends == 0 and '#rules' in failed())

# ---- 6. the old posts will not delete after the new are in ------------------
ch = channel('rules')
ch.delete_refused = True
raised = run(space['post'](ch, TEXTS['RULES'], {}))
yes('6 when the old posts will not delete, the new words are in and the run says #rules has both',
    raised is None and PARA_A in ch.mine() and '#rules' in failed() and 'old' in failed())

# ---- 7. the run goes on to the next channel ----------------------------------
bad = channel('rules', refuse_sends_from=1)
good = channel('how-to-join')
raised = run(space['write_posts']([(bad, 'RULES'), (good, 'GUIDE')], {}))
yes('7 a refused send in #rules does not stop the run before #how-to-join', raised is None)
yes('7   #how-to-join is written', TEXTS['GUIDE'] in good.mine()
    and not any(c in OLD for c in good.mine()))
yes('7   #rules keeps its old words, and is the one named',
    [c for c in bad.mine() if not c.startswith(GATE)] == OLD
    and '#rules' in failed() and '#how-to-join' not in failed())

print('')
print('%d failed' % len(FAIL))
raise SystemExit(1 if FAIL else 0)
