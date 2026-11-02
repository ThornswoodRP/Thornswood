"""
test-3336-changelogs.py

Issue #3336. On 23 Oct Patrick found the Discord changelogs gone: "every
Rules, Lore, Information and Documentation post in Discord is supposed to
have its changelog". The cause was post(): it deleted every message of the
bot's in the channel, and the "started a thread" line keep_changelog's
create_thread leaves is the bot's too, so every -Posts run after the first
took the only way into the Changelog thread out of the channel.

What this checks, with Build-Discord.py imported for real under another name
and each channel and thread a stand-in that records what was asked of it:
  1. post() replaces the bot's words and its "pinned a message" lines, and
     leaves its "started a thread" line and everybody else's messages;
  2. keep_changelog makes the thread once (locked, a week before Discord
     archives it), finds it again open or archived, adds only missing lines,
     and hands it back; the post then ends on a link to it;
  3. -Posts makes the thread before it writes the post, so the first post
     already links it;
  4. the audit's changelog_drift says nothing for a doc in order, and says
     each of: no thread, missing lines, a post that does not link it;
  5. every doc the build writes and is not a draft has change lines, so every
     one of them gets a changelog;
  6. the thread holds content.py's lines and no others (#3656: two lines went
     out saying "Patrick confirmed it (#3656)", and the thread kept every line
     it was ever sent, so rewording them in content.py changed nothing live):
     a line reworded there is taken down from where it differs and the rest
     posted again in order, a line taken out goes, an archived thread is
     opened before the deletes, other people's messages stay, and the audit
     says a thread with lines content.py no longer has;
  7. check_docs refuses a change line or live words with an issue number or
     a team member's name, and a channel name is not a number.

Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import importlib.util
import types

spec = importlib.util.spec_from_file_location('build_discord_3336', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)
discord = B.discord

passed = failed = 0


def yes(what, cond):
    global passed, failed
    if cond:
        passed += 1
        print('PASS  ' + what)
    else:
        failed += 1
        print('FAIL  ' + what)


BOT = 4242
B.client = types.SimpleNamespace(user=types.SimpleNamespace(id=BOT))
T = discord.MessageType


class Msg(object):
    def __init__(self, ch, author, content, kind=T.default):
        self.ch, self.author, self.content, self.type = ch, types.SimpleNamespace(id=author), content, kind
        self.pinned = False

    async def delete(self):
        self.ch.log.append(('delete', self.content))
        self.ch.msgs.remove(self)

    async def pin(self):
        self.pinned = True


class Thread(object):
    def __init__(self, tid, name, log):
        self.id, self.name, self.log, self.msgs = tid, name, log, []
        self.mention = '<#%d>' % tid
        self.locked = False
        self.archived = False

    async def history(self, limit=None, oldest_first=False):
        # Discord's order: newest first unless asked otherwise.
        for m in (list(self.msgs) if oldest_first else list(self.msgs)[::-1]):
            yield m

    async def send(self, text):
        self.log.append(('thread.send', text))
        self.msgs.append(Msg(self, BOT, text))

    async def edit(self, **kw):
        self.log.append(('thread.edit', kw))
        self.locked = kw.get('locked', self.locked)
        self.archived = kw.get('archived', self.archived)


class Channel(object):
    type = None

    def __init__(self, name):
        self.name, self.log, self.msgs = name, [], []
        self.threads, self.archived = [], []

    async def history(self, limit=None):
        for m in list(self.msgs)[::-1]:
            yield m

    async def archived_threads(self, limit=None):
        for t in self.archived:
            yield t

    async def send(self, text):
        self.log.append(('send', text))
        m = Msg(self, BOT, text)
        self.msgs.append(m)
        return m

    async def create_thread(self, name, type=None, auto_archive_duration=None, reason=None):
        self.log.append(('create_thread', name, auto_archive_duration))
        t = Thread(900 + len(self.threads), name, self.log)
        self.threads.append(t)
        self.msgs.append(Msg(self, BOT, name, T.thread_created))
        return t


def run(coro):
    return asyncio.run(coro)


# ---- 1. post() keeps the "started a thread" line
ch = Channel('rules')
ch.msgs = [Msg(ch, BOT, 'old rules'), Msg(ch, BOT, '', T.pins_add), Msg(ch, BOT, 'Changelog', T.thread_created),
           Msg(ch, 77, 'somebody else')]
B.failed = []
run(B.post(ch, 'new rules', {}))
kinds = [(m.type, m.content) for m in ch.msgs]
yes('post() replaced the bot\'s words and its pin line', (T.default, 'old rules') not in kinds and (T.pins_add, '') not in kinds and (T.default, 'new rules') in kinds)
yes('and left the "started a thread" line and other people\'s messages', (T.thread_created, 'Changelog') in kinds and (T.default, 'somebody else') in kinds)
yes('doc_post_of_mine takes only the bot\'s words and pin lines',
    B.doc_post_of_mine(Msg(ch, BOT, 'x'), BOT) and B.doc_post_of_mine(Msg(ch, BOT, '', T.pins_add), BOT)
    and not B.doc_post_of_mine(Msg(ch, BOT, 'Changelog', T.thread_created), BOT) and not B.doc_post_of_mine(Msg(ch, 77, 'x'), BOT))

# ---- 2. keep_changelog
key = 'RULES'
ch = Channel('rules')
B.failed = []
t = run(B.keep_changelog(ch, key))
lines = B.change_lines(key)
yes('a missing thread is made once, with a week before Discord archives it, and locked',
    t is not None and ch.log[0] == ('create_thread', 'Changelog', 10080) and t.locked)
yes('every change line goes in, in order', [m.content for m in t.msgs] == lines)
again = run(B.keep_changelog(ch, key))
yes('a second run finds it and adds nothing', again is t and len([x for x in ch.log if x[0] == 'create_thread']) == 1 and len(t.msgs) == len(lines))
arch = Channel('rules')
old = Thread(5, 'Changelog', arch.log)
old.msgs = [Msg(old, BOT, lines[0])]
arch.archived = [old]
got = run(B.keep_changelog(arch, key))
yes('an archived thread is found, not made again, and gets only its missing lines',
    got is old and not [x for x in arch.log if x[0] == 'create_thread'] and [m.content for m in old.msgs] == lines)
text = B.doc_with_footer(key, t)
yes('the post ends on a link to the thread', text.rstrip().endswith('in the Changelog thread, %s.*' % t.mention))
yes('and says the newest change', B.nice_date(B.C.CHANGES[key][-1][0]) in text and B.C.CHANGES[key][-1][1] in text)

# ---- 3. -Posts makes the thread first
src = open(os.path.join(HERE, 'Build-Discord.py'), encoding='utf-8').read()
at = src.index('thread = await keep_changelog(ch, key)')
yes('-Posts makes the thread before it writes the post, and the post links it',
    at < src.index('await post(ch, doc_with_footer(key, thread), found)', at))

# ---- 4. the audit
ch = Channel('rules')
B.failed = []
t = run(B.keep_changelog(ch, key))
run(B.post(ch, B.doc_with_footer(key, t), {}))
yes('a doc in order: the audit says nothing', run(B.changelog_drift(ch, key, BOT)) == [])
bare = Channel('lore')
yes('no thread: the audit says so', run(B.changelog_drift(bare, 'LORE', BOT)) == ['it has no Changelog thread; -Posts makes it'])
t.msgs = t.msgs[:1]
d = run(B.changelog_drift(ch, key, BOT))
yes('missing lines: the audit counts them', any('missing %d change line' % (len(lines) - 1) in x for x in d))
ch2 = Channel('faq')
t2 = run(B.keep_changelog(ch2, 'FAQ'))
run(B.post(ch2, B.doc_with_footer('FAQ'), {}))
yes('a post without the link: the audit says so', run(B.changelog_drift(ch2, 'FAQ', BOT)) == ['its post does not link its Changelog thread; -Posts writes the link'])
yes('the audit reads every doc channel the plan writes', 'changelog_drift(ch, key, getattr(me, "id", None))' in src and "docs.append((ch, spec['key']))" in src)

# ---- 5. every written doc that is not a draft has a changelog
written = [k for k in B.doc_keys() if k not in B.C.DRAFTS]
yes('every doc the build writes, drafts aside, has change lines (%s)' % ', '.join(written),
    written and all(B.C.CHANGES.get(k) for k in written))
yes('and check_docs finds nothing missing', B.check_docs() == [])

# ---- 6. the thread follows content.py (#3656)
key = 'LORE'
lines = B.change_lines(key)
ch = Channel('lore')
B.failed = []
t = run(B.keep_changelog(ch, key))
said = lines[-1].replace('this is 4E 252.', 'this is 4E 252. Patrick confirmed it (#3656).')
t.msgs[-1].content = said
t.msgs.insert(1, Msg(t, 77, 'somebody else'))
ch.log[:] = []
run(B.keep_changelog(ch, key))
yes('a line reworded in content.py is reworded in the thread too',
    [m.content for m in t.msgs if m.author.id == BOT] == lines and said not in [m.content for m in t.msgs])
yes('  by taking down only that line and posting it again',
    [x for x in ch.log if x[0] in ('delete', 'thread.send')] == [('delete', said), ('thread.send', lines[-1])])
yes('  and somebody else\'s message stays', 'somebody else' in [m.content for m in t.msgs])
t.msgs = [m for m in t.msgs if m.author.id == BOT]
t.msgs[1].content = 'an older wording'
ch.log[:] = []
run(B.keep_changelog(ch, key))
yes('a line differing in the middle: it and the ones after it go, and are posted again in order',
    [m.content for m in t.msgs] == lines and
    [x[1] for x in ch.log if x[0] == 'delete'] == ['an older wording'] + lines[2:] and
    [x[1] for x in ch.log if x[0] == 'thread.send'] == lines[1:])
t.msgs.append(Msg(t, BOT, 'a line content.py no longer has'))
t.archived = True
ch.log[:] = []
d = run(B.changelog_drift(ch, key, BOT))
yes('the audit says a thread has a line content.py no longer has',
    any('1 line(s) content.py no longer has' in x for x in d))
run(B.keep_changelog(ch, key))
yes('a line taken out of content.py goes, and nothing is posted again',
    [m.content for m in t.msgs] == lines and not [x for x in ch.log if x[0] == 'thread.send'])
yes('  in an archived thread, opened before the delete',
    ch.log.index(('thread.edit', {'archived': False})) < ch.log.index(('delete', 'a line content.py no longer has')))
ch.log[:] = []
run(B.keep_changelog(ch, key))
yes('a thread already in order is asked nothing', ch.log == [])

# ---- 7. check_docs refuses what a public line never says (#3656)
saved = B.C.CHANGES[key]
try:
    B.C.CHANGES[key] = saved[:-1] + [(saved[-1][0], saved[-1][1] + ' Patrick confirmed it (#3656).', saved[-1][2])]
    bad = B.check_docs()
    yes('check_docs refuses a change line with an issue number and a team member\'s name',
        len([b for b in bad if b.startswith('LORE, its change line of')]) == 2
        and any('issue or pull request number' in b for b in bad)
        and any('name of somebody on the team' in b for b in bad))
finally:
    B.C.CHANGES[key] = saved
saved = B.C.DOCS['FACTIONS']
try:
    B.C.DOCS['FACTIONS'] = saved + '\nClaude wrote this.'
    yes('and live words with one', any(b.startswith('FACTIONS, its words: a name') for b in B.check_docs()))
finally:
    B.C.DOCS['FACTIONS'] = saved
yes('a channel name such as #test-findings is not a number', B.C.not_public('Bugs go in #test-findings.') == [])
yes('and check_docs finds nothing in the docs as they are', B.check_docs() == [])

print('')
print('%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
