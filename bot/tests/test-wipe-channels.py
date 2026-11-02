"""
test-wipe-channels.py

Patrick, 22 Oct 2026: every Discord channel's messages go except rules,
instructions, documentation, known issues and test tasks, and both news
channels and #staff-updates go with them. Wipe-Channels.py does it.

What this checks, with Wipe-Channels.py imported for real under another name
and the server a stand-in that records what would have been asked of Discord:
  1. which channels are kept: every rules, known issues and test tasks
     channel, the instruction channels, the ticket and hold panels, the
     records unless --wipe-records, --keep, an emoji before the name;
     and which go: both #news, #staff-updates, #general-chat, the forums;
  2. without --go nothing is deleted, and each channel says what would go;
  3. with --go a wiped channel loses every message but the bot's panels and
     every thread, open or archived; a kept channel and its threads (an open
     application) are not touched;
  4. --only does one channel and stops on a name the server does not have.

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
import contextlib
import importlib.util
import io
import types

spec = importlib.util.spec_from_file_location('wipe', os.path.join(HERE, 'Wipe-Channels.py'))
wipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wipe)

passed = failed = 0


def yes(what, cond):
    global passed, failed
    if cond:
        passed += 1
        print('PASS  ' + what)
    else:
        failed += 1
        print('FAIL  ' + what)


# ---- 1. which channels
kept = ['rules', 'game-rules', 'gm-rules', 'known-issues', 'Test-Tasks', 'dev-test-tasks',
        'test-tasks-archive', 'welcome', 'start-here', 'faq', 'lore', 'tickets-and-applications',
        'choose-your-hold', 'server-instructions', 'documentation', '📜┃rules',
        'lore-rules', 'mod-rules', 'content-rules', 'support-rules', 'dev-rules', 'playtester-rules']
for n in kept:
    yes('#%s is kept' % n, wipe.why_kept(n) != '')
gone = ['news', 'updates', 'staff-updates', 'staff-general', 'general-chat', 'suggestions',
        'test-findings', 'dev-test-results', 'welcome-travelers', 'say-hello', 'whiterun',
        'character-introductions', 'gm-chat', 'media']
for n in gone:
    yes('#%s goes' % n, wipe.why_kept(n) == '')
yes('the records stay unless --wipe-records', wipe.why_kept('tickets') != '' and wipe.why_kept('gm-discipline') != ''
    and wipe.why_kept('ticket-log') != '' and wipe.why_kept('ticket-log', wipe_records=True) == ''
    and wipe.why_kept('tickets', wipe_records=True) == '' and wipe.why_kept('gm-discipline', wipe_records=True) == '')
yes('--keep keeps a channel', wipe.why_kept('media', keep=['media']) != '')


# ---- the stand-in server
class Kind:
    forum = 'forum'
    text = 'text'


class Cat:
    def __init__(self, cid, name):
        self.id, self.name = cid, name


class Msg:
    def __init__(self, author, components=None, pinned=False, kind='default', content=''):
        self.author = types.SimpleNamespace(id=author)
        self.components = components or []
        self.pinned, self.type, self.content = pinned, kind, content


class Thread:
    def __init__(self, tid, parent, log, name='a thread'):
        self.id, self.parent_id, self.log, self.name = tid, parent, log, name

    async def delete(self):
        self.log.append(('delete thread', self.id))


class Text:
    type = Kind.text

    def __init__(self, cid, name, cat, msgs, log, archived=()):
        self.id, self.name, self.category_id, self.position = cid, name, cat, cid
        self.msgs, self.log, self.archived = list(msgs), log, list(archived)

    async def history(self, limit=None):
        for m in list(self.msgs):
            yield m

    async def archived_threads(self, limit=None, private=False):
        for t in self.archived:
            if getattr(t, 'private', False) == private:
                yield t

    async def purge(self, limit=None, check=None, bulk=True, reason=None):
        done = [m for m in self.msgs if check(m)]
        self.msgs = [m for m in self.msgs if not check(m)]
        self.log.append(('purge', self.name, len(done)))
        return done


class Forum:
    type = Kind.forum

    def __init__(self, cid, name, cat, log, archived=()):
        self.id, self.name, self.category_id, self.position = cid, name, cat, cid
        self.log, self.archived = log, list(archived)

    async def archived_threads(self, limit=None):
        for t in self.archived:
            yield t


BOT = 1


def server():
    log = []
    panel = Msg(BOT, ['button'])
    chans = [
        Cat(100, 'Start Here'),
        Text(1, 'rules', 100, [Msg(BOT), Msg(BOT)], log),
        Text(2, 'tickets-and-applications', 100, [panel], log),
        Text(3, 'news', 100, [Msg(BOT, pinned=True), Msg(BOT, kind='thread_created', content='Changelog'),
                              Msg(BOT), Msg(9), Msg(9)], log),
        Text(4, 'staff-updates', 100, [Msg(BOT)] * 5, log),
        Text(5, 'general-chat', 100, [Msg(7), Msg(8), Msg(BOT, ['button'])], log,
             archived=[types.SimpleNamespace(id=50, parent_id=5, private=False, delete=None)]),
        Forum(6, 'suggestions', 100, log),
    ]
    old = Thread(50, 5, log)
    chans[5].archived = [old]
    # a suggestion post, an open application, #news's changelog
    active = [Thread(60, 6, log), Thread(61, 2, log), Thread(62, 3, log, 'Changelog')]

    class Guild:
        name = 'Thornswood'
        id = 999

        async def fetch_channels(self):
            return chans

        async def active_threads(self):
            return active

    guild = Guild()

    class Client:
        user = types.SimpleNamespace(id=BOT)

        async def fetch_guilds(self, limit=None):
            yield guild

        async def fetch_guild(self, gid):
            return guild

    return Client(), chans, log


wipe.discord = types.SimpleNamespace(CategoryChannel=Cat, TextChannel=Text,
                                     ChannelType=types.SimpleNamespace(forum=Kind.forum),
                                     MessageType=types.SimpleNamespace(thread_created='thread_created'))


def run(argv):
    client, chans, log = server()
    wipe.client = client
    p = wipe.argparse.ArgumentParser()
    p.add_argument('--go', action='store_true')
    p.add_argument('--keep', action='append', default=[])
    p.add_argument('--only', action='append', default=[])
    p.add_argument('--wipe-records', action='store_true')
    args = p.parse_args(argv)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = asyncio.run(wipe.work(args))
    return code, out.getvalue(), chans, log


# ---- 2. without --go
code, out, chans, log = run([])
yes('without --go it exits 0 and deletes nothing', code == 0 and not log)
yes('it says #rules and the ticket panel are kept', 'KEEP  #rules' in out and 'KEEP  #tickets-and-applications' in out)
yes('it says what #news would lose', 'WIPE  #news (Start Here): would delete 3 message(s) and 0 thread(s)' in out)
yes('and #general-chat, its old thread and the panel it keeps',
    'WIPE  #general-chat (Start Here): would delete 2 message(s) and 1 thread(s), keeps 1 panel(s)' in out)
yes('and the forum\'s posts', 'WIPE  #suggestions (Start Here): would delete 0 message(s) and 1 thread(s)' in out)

# ---- 3. with --go
code, out, chans, log = run(['--go'])
by = {getattr(c, 'name', ''): c for c in chans}
yes('--go exits 0', code == 0)
yes('#staff-updates is empty', not by['staff-updates'].msgs)
yes('#news keeps only its pinned doc and the line that opens its Changelog thread',
    [(m.pinned, m.type) for m in by['news'].msgs] == [(True, 'default'), (False, 'thread_created')])
yes('and its Changelog thread is not deleted', ('delete thread', 62) not in log)
yes('#factions is kept', wipe.why_kept('factions') != '')
yes('#general-chat keeps only the bot\'s panel', len(by['general-chat'].msgs) == 1 and by['general-chat'].msgs[0].components)
yes('its archived thread and the forum post are deleted', ('delete thread', 50) in log and ('delete thread', 60) in log)
yes('#rules and the open application are not touched',
    len(by['rules'].msgs) == 2 and ('delete thread', 61) not in log and not [x for x in log if x[:2] == ('purge', 'rules')])
yes('it says what went', 'deleted 10 message(s) and 2 thread(s); 0 channel(s) failed' in out)

# ---- 4. --only
code, out, chans, log = run(['--go', '--only', 'news'])
by = {getattr(c, 'name', ''): c for c in chans}
yes('--only news empties #news and nothing else', len(by['news'].msgs) == 2 and len(by['general-chat'].msgs) == 3 and len(log) == 1)
code, out, chans, log = run(['--go', '--only', 'nope'])
yes('--only a name the server does not have stops before anything', code == 1 and not log and 'no channel called #nope' in out)

print('')
print('%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
