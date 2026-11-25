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
import sys
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
        self.channel.calls.append(('pin', self.id))
        self.channel.pins_made += 1
        if self.channel.pins_made == self.channel.refuse_pin:
            raise Forbidden(403, 'Missing Permissions')
        self.pinned = True

    async def unpin(self):
        self.channel.calls.append(('unpin', self.id))
        if self.channel.unpin_refused:
            raise Forbidden(403, 'Missing Permissions')
        self.pinned = False


class Channel(object):
    """A read only channel. refuse_send is the 1-based send Discord refuses
       (0: none); refuse_sends_from refuses that one and every one after."""
    def __init__(self, name, refuse_send=0, refuse_sends_from=0,
                 history_refused=False, delete_refused=False, refuse_pin=0, unpin_refused=False):
        self.name = name
        self.mention = '<#%s>' % name
        self.messages = []
        self.calls = []
        self.sends = 0
        self.refuse_send = refuse_send
        self.refuse_sends_from = refuse_sends_from
        self.history_refused = history_refused
        self.delete_refused = delete_refused
        self.refuse_pin = refuse_pin
        self.pins_made = 0
        self.unpin_refused = unpin_refused

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

    def pins(self, limit=None):
        async def walk():
            for m in list(self.messages):
                if m.pinned:
                    yield m
        return walk()

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
    'PLAN': [],
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

# A guide in a discussion channel owns only its headed post, not the chat.
prefix = '# Server progression and economy'
footer = '\n\n*Last changed 17 Nov 2026: Guide updated. Every change is in the Changelog thread, <#123456789>.*'
space['PLAN'] = [('Out of Character', [dict(name='server-progression-and-economy', post_prefix=prefix)])]
ch = Channel('server-progression-and-economy')
old_guide = ch.put(ME, prefix + '\n\nOld guide.' + footer)
old_guide.pinned = True
member = ch.put(SOMEONE, 'How does trading work?')
member.pinned = True
discussion = ch.put(ME, 'A reply to the discussion.')
discussion.pinned = True
similar = ch.put(ME, prefix + '\n\nQ&A: A discussion reply.')
similar.pinned = True
for i in range(60):
    ch.put(SOMEONE, 'A later discussion message %d' % i)
raised = run(space['post'](ch, '\n' + prefix + '\n\nCurrent guide.' + footer + '\n', {}))
yes('8 a discussion guide replaces only its old guide and is pinned',
    raised is None and member in ch.messages and discussion in ch.messages
    and similar in ch.messages
    and old_guide not in ch.messages and ch.messages[-1].pinned)
before = list(ch.messages)
raised = run(space['post'](ch, prefix + '\n\n' + 'x' * 1900 + footer, {}))
yes('8 an oversized discussion guide is refused before any message changes',
    raised is None and ch.messages == before and 'one message' in failed())
raised = run(space['post'](ch, prefix + '\n\nMalformed footer. Every change is in the Changelog thread, <#123456789>.*', {}))
yes('8 a malformed guide footer is refused before any message changes',
    raised is None and ch.messages == before and ch.messages[-1].pinned
    and 'needs its Changelog thread' in failed())
raised = run(space['post'](ch, prefix + '\n\nGuide.\n\n*Last changed stray line\n' + footer.strip(), {}))
yes('8 a multiline footer cannot replace the guide',
    raised is None and ch.messages == before and 'needs its Changelog thread' in failed())
raised = run(space['post'](ch, prefix + footer, {}))
yes('8 an empty guide cannot remove the existing pinned guide',
    raised is None and ch.messages == before and ch.messages[-1].pinned and 'is empty' in failed())

long_guide = prefix + '\n\n' + PARA_A + '\n\n' + PARA_B + footer
old_copy = ch.messages[-1]
call_start = len(ch.calls)
raised = run(space['post'](ch, long_guide, {}))
parts = [m for m in ch.messages if m.content.startswith(prefix) and m.content.endswith(footer.strip())]
yes('9 a longer guide keeps both sections, with every part pinned and within Discord limits',
    raised is None and len(parts) == 2 and all(m.pinned and len(m.content) <= 1900 for m in parts)
    and any(PARA_A in m.content for m in parts) and any(PARA_B in m.content for m in parts)
    and old_copy not in ch.messages and member in ch.messages and discussion in ch.messages and similar in ch.messages)
calls = ch.calls[call_start:]
yes('9 every new part is pinned before an old guide message is deleted',
    len([c for c in calls if c[0] == 'pin']) == 2
    and max(i for i, c in enumerate(calls) if c[0] == 'pin')
    < min(i for i, c in enumerate(calls) if c[0] == 'delete'))
for i in range(60):
    ch.put(SOMEONE, 'More discussion %d' % i)
raised = run(space['post'](ch, prefix + '\n\nUpdated short guide.' + footer, {}))
yes('9 an update finds and replaces every pinned part beyond recent chat',
    raised is None and len(parts) == 2 and all(m not in ch.messages for m in parts)
    and ch.messages[-1].pinned and member in ch.messages and similar in ch.messages)
for failures in ({'refuse_send': 2}, {'refuse_pin': 2}):
    refused = Channel('server-progression-and-economy', **failures)
    kept = refused.put(ME, prefix + '\n\nExisting guide.' + footer)
    kept.pinned = True
    raised = run(space['post'](refused, long_guide, {}))
    yes('9 a failed send or pin preserves the old pinned guide and removes all new parts: %r' % failures,
        raised is None and refused.sends == 2
        and ('refuse_pin' not in failures or refused.pins_made == 2)
        and refused.messages == [kept] and kept.pinned and 'not rewritten' in failed())

blocked = Channel('server-progression-and-economy', refuse_pin=2, delete_refused=True, unpin_refused=True)
kept = blocked.put(ME, prefix + '\n\nExisting guide.' + footer)
kept.pinned = True
raised = run(space['post'](blocked, long_guide, {}))
left = [m for m in blocked.messages if m is not kept]
yes('9 refused cleanup names every remaining replacement and its possible pin',
    raised is None and kept.pinned and len(left) == 2
    and all(('unpin', m.id) in blocked.calls and str(m.id) in failed() for m in left)
    and failed().count('pin status unknown') == 2)

edge = Channel('server-progression-and-economy')
fits = 1900 - len(prefix) - len(footer) - 2
raised = run(space['post'](edge, prefix + '\n\n' + 'x' * fits + footer, {}))
yes('9 a single guide message exactly at the limit is accepted and pinned',
    raised is None and len(edge.messages) == 1 and len(edge.messages[0].content) == 1900 and edge.messages[0].pinned)
before_edge = list(edge.messages)
raised = run(space['post'](edge, prefix + '\n\n' + 'x' * (fits + 1) + footer, {}))
yes('9 an indivisible paragraph one character over is refused without changing the guide',
    raised is None and edge.messages == before_edge and 'fit in one message' in failed())

many = Channel('server-progression-and-economy')
room = 1900 - len(prefix) - len(footer.strip()) - len('*Part 1 of 2*') - 6
body = ['x' * room] + ['z'] * 99
raised = run(space['post'](many, prefix + '\n\n' + '\n\n'.join(body) + footer, {}))
yes('9 capacity uses the actual part-label width rather than the paragraph count',
    raised is None and len(many.messages) == 2 and all(m.pinned and len(m.content) <= 1900 for m in many.messages))
indented = Channel('server-progression-and-economy')
body = '    indented paragraph  \n    next line  '
raised = run(space['post'](indented, prefix + '\n\n' + body + footer, {}))
yes('9 wrapping preserves significant paragraph whitespace',
    raised is None and indented.messages[0].content == prefix + '\n\n' + body + footer)

# The real expanded guide must fit without losing any of its paragraphs.
sys.path.insert(0, os.path.join(REPO, 'bot'))
import content as C
real = Channel('server-progression-and-economy')
words = C.DOCS['ECONOMY'].strip()
links = {key: types.SimpleNamespace(mention='<#%d>' % i)
         for i, key in enumerate(('SUGGESTIONS', 'RESULTS', 'KNOWN'), 1)}
public_words = words
for key, target in links.items():
    public_words = public_words.replace('<#' + key + '>', target.mention)
raised = run(space['post'](real, words + footer, links))
ordered = []
labels_ok = True
for i, m in enumerate(real.messages, 1):
    paras = m.content.split('\n\n')
    labels_ok = labels_ok and paras[0] == prefix and paras[-1] == footer.strip()
    if len(real.messages) > 1:
        labels_ok = labels_ok and paras[1] == '*Part %d of %d*' % (i, len(real.messages))
        ordered.extend(paras[2:-1])
    else:
        ordered.extend(paras[1:-1])
yes('10 the full current guide is present across pinned parts, with no paragraph lost',
    raised is None and len(real.messages) > 1
    and all(m.pinned and len(m.content) <= 1900 for m in real.messages)
    and labels_ok and ordered == public_words.split('\n\n')[1:])

print('')
print('%d failed' % len(FAIL))
raise SystemExit(1 if FAIL else 0)
