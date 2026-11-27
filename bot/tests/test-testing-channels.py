"""
test-testing-channels.py

Patrick's card of 11 October: the Live smoke checklist is gone from
#test-tasks, and the testing channels are a #test-tasks forum (one thread per
test task, tagged Dev or Main), #test-findings (what #test-results was) and a
#known-issues channel the bot keeps from GitHub issues labelled Dev Findings
or Main Findings.

This holds:

  1. The checklist is gone: no /live-smoke, no session code, no export.
  2. The one-time setup: a preview changes nothing, an apply makes the three
     changes with the old overwrites copied, the forum fallback when Discord
     will not convert a text channel, the archive locked and never deleted,
     and a second run does nothing at all. An apply that stopped half way
     finishes the rest and nothing twice.
  3. A test task is one thread, with its Dev or Main tag, never two for one
     title. /test-queue pages through active tests, showing their results
     privately and only to people who can read the forum.
  4. Known issues: one post per open labelled issue, never a second, not
     after a restart and not after a crash between a post and its save;
     closed or unlabelled, its post is deleted; reopened, it is back. A
     finding with a merged pull request naming it, or a "Test task:"
     comment, is not a known issue any more (Patrick, 22 Oct). A finding
     with no "Known issue:" comment has no post at all (Patrick, 12 Nov);
     the stand-in GitHub writes one for every finding not in NO_KNOWN.
  5. Test tasks from the board: one post per issue closed as fixed, always
     tagged Main whatever "Server:" line its "Test task:" comment carries
     (Patrick, 11 Oct: an issue closes when its fix is on main, where testers
     test), the Server line never in the body, and no post for a fixed
     finding nobody wrote a test task for.
  6. Posts made with an older form (TASK_FORM, KNOWN_FORM) are written again
     once after the bot is updated, though GitHub says nothing changed, and
     after that an unchanged issue is not read again.
  7. #dev-test-tasks (Patrick, 12 Oct): the one-time setup makes it in the
     Staff category by its id, with the category's overwrites and the bot's
     #test-tasks rights, records its id, finds it again by that id after a
     rename, never makes a second, and takes one already there as it is.
  8. A "Test task:" comment with "Server: Dev", written from the day
     #dev-test-tasks began, is a post there, open issue or closed, and never
     a #test-tasks post. It stays when the issue closes (a check only a dev
     can do may be up while the fix is on main, Patrick 22 Oct) and goes
     when a newer test task is not Dev; a closed issue's Main test task goes
     to #test-tasks beside it. A test task taken back takes its post down,
     and the Claude Code line under a comment is never in a post. Nothing is posted twice, not after a restart and
     not after a crash between a post and its save; a post Discord refused
     is tried again. A Server: Dev line from before that day changes nothing.
  9. "Checked: passed" newer than a test task takes its post down in either
     forum; "Checked: failed" leaves it, and a newer test task posts again.
 10. A post in #test-tasks or #dev-test-tasks whose issue GitHub deleted
     comes down (#5197): the deleted issue is in no list, so #test-tasks reads
     each post's issue it did not list, and #dev-test-tasks asks once an hour.

The real bot module is imported. Discord and GitHub are stand-ins that
count what is asked of them. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import json
import shutil
import tempfile
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
for _k in ('TEST_TASK_ROLES', 'LIVE_SMOKE_ADMIN_ROLES', 'GITHUB_TOKEN'):
    os.environ.pop(_k, None)
os.environ['GITHUB_TOKEN_FILE'] = ''  # nor the box admin service's (#5184)

import discord  # noqa: E402
import harness_bot  # noqa: E402
bot = harness_bot.whole()
bot.POST_RULES = False   # these fixtures predate the post rules; test-post-rules.py checks them

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


TMP = tempfile.mkdtemp(prefix='thornswood-testing-channels-')
LOGGED = []
bot.log = lambda *a: LOGGED.append(' '.join(str(x) for x in a))


# ------------------------------------------------------------ stand-ins --
class Refused(discord.HTTPException):
    def __init__(self, text='Cannot change the type of this channel'):
        Exception.__init__(self, text)
        self.text = text
        self.code = 50024
        self.status = 400


class Target(object):
    def __init__(self, name, tid):
        self.name = name
        self.id = tid

    def __repr__(self):
        return '<%s>' % self.name


class Category(object):
    def __init__(self, name, cid=None, overwrites=None, guild=None):
        self.name = name
        self.id = cid or (8000 + len(getattr(guild, 'categories', []) or []))
        self.type = discord.ChannelType.category
        self.overwrites = dict(overwrites or {})
        self.channels = []
        if guild is not None:
            guild.categories.append(self)


class Thread(object):
    def __init__(self, name, tags, content, forum=None, owner=2):
        self.name = name
        self.applied_tags = tags
        self.content = content
        self.embeds = []
        self.archived = False
        self.locked = False
        self.mention = '<#%s>' % name
        self.forum = forum
        self.parent_id = getattr(forum, 'id', None)
        self.owner_id = owner
        Thread.next = getattr(Thread, 'next', 50000) + 1
        self.id = Thread.next
        self.more = []          # messages after the first post, in order
        if forum is not None:
            forum.guild.threads[self.id] = self

    async def send(self, content, **k):
        assert 0 < len(content) <= 2000, len(content)
        Thread.next += 1
        m = Msg(Thread.next, content, self)
        self.more.append(m)
        self.forum.guild.calls.append(('send', self.name))
        return m

    async def fetch_message(self, mid):
        if mid == self.id:
            msg = Msg(self.id, self.content, self)
            msg.embeds = self.embeds
            return msg
        for m in self.more:
            if m.id == mid:
                return m
        raise discord.NotFound(type('R', (), {'status': 404, 'reason': 'gone'})(),
                               'Unknown Message')

    async def history(self, limit=100, oldest_first=False):
        # The first post comes back too, with the thread's own id.
        yield Msg(self.id, self.content, self)
        for m in list(self.more)[:limit]:
            yield m

    def text(self):
        """Everything the post says, first post and follow-ups, in order."""
        return '\n'.join([self.content] + [m.content for m in self.more])

    async def edit(self, name=None, applied_tags=None, **k):
        self.forum.guild.calls.append(('edit_thread', self.forum.name, name))
        if name is not None:
            self.name = name
        if applied_tags is not None:
            self.applied_tags = applied_tags
        if 'archived' in k:
            self.archived = k['archived']
        return self

    @property
    def starter_message(self):
        th = self

        class Starter(object):
            async def edit(self, content=None, **k):
                assert 0 < len(content) <= 2000, len(content)
                th.content = content
        return Starter()

    async def delete(self):
        self.forum.guild.calls.append(('delete_thread', self.forum.name, self.name))
        self.forum.threads.remove(self)
        del self.forum.guild.threads[self.id]


class Msg(object):
    def __init__(self, mid, content, thread):
        self.id = mid
        self.content = content
        self.thread = thread
        self.author = Target('Thornswood Bot', 2)

    async def edit(self, content=None, **k):
        assert 0 < len(content) <= 2000, len(content)
        self.content = content

    async def delete(self):
        self.thread.more.remove(self)


class Said(object):
    def __init__(self, author, content='x'):
        self.author = author
        self.content = content


class Channel(object):
    def __init__(self, guild, name, kind, category=None, position=0,
                 overwrites=None, tags=None, convertible=False):
        self.guild = guild
        self.name = name
        self.type = getattr(discord.ChannelType, kind)
        self.category = category
        self.position = position
        self.overwrites = dict(overwrites or {})
        self.available_tags = list(tags or [])
        self.threads = []
        self.convertible = convertible
        self.id = 9000 + len(guild.channels)
        self.sent = []
        self.said = []
        guild.channels.append(self)
        if category is not None and hasattr(category, 'channels'):
            category.channels.append(self)

    async def history(self, limit=100):
        for m in self.said[:limit]:
            yield m

    async def delete(self, reason=None):
        self.guild.calls.append(('delete', self.name))
        self.guild.channels.remove(self)
        if self.category is not None and self in getattr(self.category, 'channels', []):
            self.category.channels.remove(self)

    def overwrites_for(self, t):
        ow = self.overwrites.get(t)
        if ow is None:
            return discord.PermissionOverwrite()
        a, d = ow.pair()
        return discord.PermissionOverwrite.from_pair(a, d)

    async def edit(self, **k):
        self.guild.calls.append(('edit', self.name, dict(k)))
        if 'type' in k:
            if not self.convertible:
                raise Refused()
            self.type = k['type']
        if 'name' in k:
            self.name = k['name']
        if 'available_tags' in k:
            self.available_tags = list(k['available_tags'])

    async def set_permissions(self, t, overwrite=None, reason=None):
        self.guild.calls.append(('set_permissions', self.name, t))
        self.overwrites[t] = overwrite

    async def archived_threads(self, limit=None, **k):
        # Discord keeps closed posts out of .threads; the stand-in keeps them
        # in the one list and marks them, so the open-only loop skips them.
        for th in list(self.threads):
            if getattr(th, 'archived', False):
                yield th

    async def create_thread(self, name, content, applied_tags, reason=None, **k):
        self.guild.calls.append(('create_thread', self.name, name))
        assert 0 < len(content) <= 2000, len(content)
        th = Thread(name, applied_tags, content, self)
        self.threads.append(th)
        if 'embed' in k:
            th.embeds = [k['embed']]
            msg = await th.fetch_message(th.id)
            return type('CreatedPost', (), {'thread': th, 'message': msg})()
        return th


class Guild(object):
    def __init__(self, gid=1):
        self.id = gid
        self.name = 'Thornswood'
        self.channels = []
        self.calls = []
        self.default_role = Target('@everyone', gid)
        self.me = Target('Thornswood Bot', 2)
        self.threads = {}
        self.categories = []

    def get_channel(self, cid):
        for ch in self.channels + self.categories:
            if getattr(ch, 'id', None) == cid:
                return ch
        return None

    def get_thread(self, tid):
        return self.threads.get(tid)

    async def active_threads(self):
        return [thread for thread in self.threads.values() if not thread.archived]

    async def fetch_channel(self, tid):
        if tid in self.threads:
            return self.threads[tid]
        raise discord.NotFound(type('R', (), {'status': 404, 'reason': 'gone'})(), 'Unknown Channel')

    async def create_forum(self, name, category=None, position=0,
                           overwrites=None, topic=None, available_tags=None,
                           reason=None):
        self.calls.append(('create_forum', name))
        return Channel(self, name, 'forum', category, position, overwrites,
                       available_tags)

    async def create_text_channel(self, name, category=None, overwrites=None,
                                  topic=None, reason=None):
        self.calls.append(('create_text_channel', name))
        return Channel(self, name, 'text', category, 0, overwrites)


def OW(**k):
    return discord.PermissionOverwrite(**k)


STAFF_ID = 1549254990110134374


def server(convertible=False, staff_category=True):
    g = Guild()
    testing = Category('Testing', guild=g)
    play = Target('Playtester', 11)
    staff = Target('Moderator', 12)
    if staff_category:
        # The Staff category, by the id Patrick gave: shut to @everyone and
        # to Playtester, open to staff, and the bot's own way in.
        Category('Staff', STAFF_ID, {
            g.default_role: OW(view_channel=False),
            play: OW(view_channel=False),
            staff: OW(view_channel=True, send_messages=True),
            g.me: OW(view_channel=True, send_messages=True,
                     read_message_history=True),
        }, guild=g)
    tasks = Channel(g, 'test-tasks', 'text', testing, 4, {
        g.default_role: OW(view_channel=False),
        play: OW(view_channel=True, send_messages=True),
        staff: OW(view_channel=True, send_messages=True, manage_threads=True),
        g.me: OW(view_channel=True, send_messages=True),
    }, convertible=convertible)
    results = Channel(g, 'test-results', 'forum', testing, 3, {
        g.default_role: OW(view_channel=False),
        play: OW(view_channel=True, send_messages=True),
    })
    Channel(g, 'general', 'text')
    return g, tasks, results, play, staff


def pairs(ows):
    return dict((t, tuple(v.value for v in o.pair())) for t, o in ows.items())


def run(c):
    return asyncio.run(c)


# ---------------------------------------------- 1. the checklist is gone --
src = harness_bot.source()
yes('bot.py has no Live smoke code left: no live_smoke function, no '
    'LIVE_SMOKE setting, no /live-smoke group',
    not [n for n in dir(bot) if n.lower().startswith('live_smoke')]
    and 'LIVE_SMOKE_EXPORT' not in src and "name='live-smoke'" not in src
    and 'LiveSmoke' not in src)
yes('and no Pass/Fail/Skip/Fail-known marks or session buttons',
    "'Fail-known'" not in src and "'ls:" not in src)
yes('the export it read is gone from the repository',
    not os.path.exists(os.path.join(HERE, 'live-smoke-discord-export.json')))
names = bot._command_names()
yes('the commands are /close and /test-task, nothing of the checklist (%s)'
    % ', '.join(names),
    'close' in names and 'test-task' in names
    and 'faction-seat' not in names
    and not [n for n in names if 'smoke' in n])
import inspect  # noqa: E402
hook = inspect.getsource(bot.Thornswood.setup_hook)
yes('setup_hook registers no Live smoke views', 'live_smoke' not in hook)
ready = inspect.getsource(bot.on_ready)
yes('the one-time setup is never run on a normal start',
    'channel_setup' not in ready and 'channel_setup' not in hook)
yes('and the known issues watcher is started once, with the others',
    'watch_known_issues()' in ready)


# -------------------------------------------------------- 2. the setup --
state = os.path.join(TMP, 'channel-setup.json')

g, tasks, results, play, staff = server()
before = pairs(tasks.overwrites)
said = run(bot.channel_setup(g, apply=False, path=state))
yes('a preview asks Discord for nothing and writes no state',
    g.calls == [] and not os.path.exists(state))
text = '\n'.join(said)
yes('  and says each of the three changes it would make',
    'would try to convert #test-tasks' in text
    and 'would make a new forum #test-tasks in Testing' in text
    and 'would rename the old text #test-tasks to #test-tasks-archive' in text
    and 'would rename #test-results to #test-findings' in text
    and 'would make the forum #known-issues in Testing' in text
    and 'would make #known-issues read only' in text
    and 'would make the forum #dev-test-tasks in Staff' in text)

said = run(bot.channel_setup(g, apply=True, path=state))
text = '\n'.join(said)
forum = bot._channel_named(g, 'test-tasks', ('forum',))
yes('Discord refusing the conversion is said, and the fallback taken',
    'refused the conversion' in text and forum is not None
    and forum is not tasks)
yes('  the forum is in the same category at the same position',
    forum.category is tasks.category and forum.position == 4)
yes('  with the old channel\'s overwrites copied exactly, as new objects',
    pairs(forum.overwrites) == before
    and not any(forum.overwrites[t] is tasks.overwrites.get(t)
                for t in forum.overwrites))
yes('  and the Dev and Main tags',
    sorted(t.name for t in forum.available_tags) == ['Dev', 'Main'])
yes('the old text channel is kept, renamed test-tasks-archive, not deleted',
    tasks.name == 'test-tasks-archive' and tasks in g.channels
    and not [c for c in g.calls if c[0] == 'delete'])
locked = [t for t in (g.default_role, play, staff)
          if tasks.overwrites[t].send_messages is False
          and tasks.overwrites[t].send_messages_in_threads is False
          and tasks.overwrites[t].create_public_threads is False]
yes('  with sending switched off for @everyone, Playtester and Moderator',
    len(locked) == 3)
yes('  and nothing else about who sees it changed',
    tasks.overwrites[play].view_channel is True
    and tasks.overwrites[staff].manage_threads is True
    and tasks.overwrites[g.default_role].view_channel is False)
yes('  and the bot\'s own overwrite left alone, so it can still read it',
    not [c for c in g.calls if c[0] == 'set_permissions' and c[2] is g.me]
    and tasks.overwrites[g.me].send_messages is True)
yes('#test-results is renamed #test-findings, the same channel and overwrites',
    results.name == 'test-findings'
    and pairs(results.overwrites)[play] == pairs(
        {play: OW(view_channel=True, send_messages=True)})[play])
known = bot._channel_named(g, 'known-issues', ('forum',))
yes('#known-issues is made as a FORUM, with the Dev and Main tags',
    known is not None and bot._channel_named(g, 'known-issues', ('text',)) is None
    and sorted(x.name for x in known.available_tags) == ['Dev', 'Main'])
yes('#known-issues is made beside #test-findings, seen by the same people',
    known is not None and known.category is results.category
    and set(results.overwrites) <= set(known.overwrites)
    and all(known.overwrites[t].view_channel == results.overwrites[t].view_channel
            for t in results.overwrites))
yes('  and read only: no sending or threads for @everyone or the copied '
    'tester overwrite',
    all(known.overwrites[t].send_messages is False
        and known.overwrites[t].send_messages_in_threads is False
        and known.overwrites[t].create_public_threads is False
        for t in (g.default_role, play)))
yes('  while the bot keeps posting there, and may delete its posts',
    known.overwrites[g.me].send_messages is True
    and known.overwrites[g.me].view_channel is True
    and known.overwrites[g.me].manage_threads is True)
yes('  and #test-findings itself is untouched by that',
    results.overwrites[play].send_messages is True)
done = json.load(open(state))
yes('the apply is recorded in the state file by server id, the forum steps too',
    '1' in done.get('guilds', {}) and done['guilds']['1'].get('done')
    and done['guilds']['1'].get('known_forum')
    and done['guilds']['1'].get('dev_tasks')
    and done['guilds']['1'].get('dev_tasks_id')
    == getattr(bot._channel_named(g, 'dev-test-tasks', ('forum',)), 'id', None))

g.calls = []
said = run(bot.channel_setup(g, apply=True, path=state))
yes('a SECOND RUN does nothing at all and says it was already done',
    g.calls == [] and len(said) == 1 and said[0].startswith('already done'))
said = run(bot.channel_setup(g, apply=False, path=state))
yes('  and nor does a preview after it', g.calls == [])

# The conversion, if Discord ever allows it: no new forum and no archive.
state2 = os.path.join(TMP, 'convert.json')
g, tasks, results, play, staff = server(convertible=True)
run(bot.channel_setup(g, apply=True, path=state2))
yes('a channel Discord does convert stays the one channel, no forum made '
    'and nothing archived',
    tasks.type is discord.ChannelType.forum and tasks.name == 'test-tasks'
    and not [c for c in g.calls if c[0] == 'create_forum' and c[1] == 'test-tasks']
    and not bot._channel_named(g, 'test-tasks-archive'))
yes('  and it is given the Dev and Main tags',
    sorted(t.name for t in tasks.available_tags) == ['Dev', 'Main'])

# Half done: the forum and the rename happened, then it stopped.
state3 = os.path.join(TMP, 'half.json')
g, tasks, results, play, staff = server()
tasks.name = 'test-tasks-archive'
Channel(g, 'test-tasks', 'forum', tasks.category, 4, tasks.overwrites,
        [discord.ForumTag(name='Dev')])
results.name = 'test-findings'
g.calls = []
said = run(bot.channel_setup(g, apply=True, path=state3))
yes('an apply that stopped half way does only what is left: the missing '
    'Main tag, #known-issues and #dev-test-tasks',
    [c[0] for c in g.calls] == ['edit', 'create_forum', 'create_forum']
    and 'available_tags' in g.calls[0][2]
    and [c[1] for c in g.calls[1:]] == ['known-issues', 'dev-test-tasks'])

# A state file that will not read changes nothing.
bad = os.path.join(TMP, 'bad.json')
open(bad, 'w').write('{not json')
g, *_ = server()
said = run(bot.channel_setup(g, apply=True, path=bad))
yes('a state file that will not read changes nothing', g.calls == []
    and 'cannot be read' in said[0])

# No #test-tasks at all.
g = Guild()
said = run(bot.channel_setup(g, apply=True, path=os.path.join(TMP, 'none.json')))
yes('a server with no #test-tasks is told so and nothing is made',
    g.calls == [] and 'there is no #test-tasks' in said[0]
    and not os.path.exists(os.path.join(TMP, 'none.json')))


# ----------------------------------- 2b. #known-issues becomes a forum --
# A server set up on 11 Oct before this: a text #known-issues full of the
# bot's own list, and a state file with done but no known_forum.
def old_shape(state_path, with_human=False):
    g, tasks, results, play, staff = server()
    run(bot.channel_setup(g, apply=True, path=state_path))
    forum_k = bot._channel_named(g, 'known-issues', ('forum',))
    g.channels.remove(forum_k)
    k = Channel(g, 'known-issues', 'text', results.category, 5,
                bot.known_overwrites(g, results))
    k.said = [Said(g.me) for _ in range(26)]
    if with_human:
        k.said.append(Said(play, 'a person wrote here'))
    st = json.load(open(state_path))
    st['guilds']['1'].pop('known_forum', None)
    json.dump(st, open(state_path, 'w'))
    tasks_forum = bot._channel_named(g, 'test-tasks', ('forum',))
    tasks_forum.overwrites[g.me] = OW(view_channel=True, send_messages=True)
    g.calls = []
    return g, k, tasks_forum


mig = os.path.join(TMP, 'migrate.json')
g, k, tf = old_shape(mig)
said = run(bot.channel_setup(g, apply=False, path=mig))
text = '\n'.join(said)
yes('on a server set up before, a preview says it would delete the text '
    '#known-issues (only the bot\'s own list) and make the forum, and asks '
    'Discord for nothing',
    g.calls == [] and 'would delete the text #known-issues' in text
    and 'its 26 message(s) are all the bot' in text
    and 'would make the forum #known-issues' in text)
said = run(bot.channel_setup(g, apply=True, path=mig))
kf = bot._channel_named(g, 'known-issues', ('forum',))
yes('  the apply deletes that text channel and makes the forum in its place',
    ('delete', 'known-issues') in g.calls and k not in g.channels
    and kf is not None and kf.category is k.category)
yes('  the bot may now delete posts in #test-tasks too (for a reopened issue)',
    tf.overwrites[g.me].manage_threads is True)
yes('  recorded as known_forum, and a second run does nothing',
    json.load(open(mig))['guilds']['1'].get('known_forum')
    and (lambda c: (run(bot.channel_setup(g, apply=True, path=mig)), g.calls == c)[1])(list(g.calls)))

mig2 = os.path.join(TMP, 'migrate2.json')
g, k, tf = old_shape(mig2, with_human=True)
run(bot.channel_setup(g, apply=True, path=mig2))
yes('a text #known-issues holding anything that is not the bot\'s is kept, '
    'renamed known-issues-archive and locked, never deleted',
    k in g.channels and k.name == 'known-issues-archive'
    and not [c for c in g.calls if c[0] == 'delete']
    and bot._channel_named(g, 'known-issues', ('forum',)) is not None)


# --------------------------------------------------- 3. test tasks --
g, tasks, results, play, staff = server()
run(bot.channel_setup(g, apply=True, path=os.path.join(TMP, 'tasks.json')))
forum = bot._channel_named(g, 'test-tasks', ('forum',))
th, said = run(bot.post_test_task(g, 'Ride the ferry to Solstheim',
                                  'Board at Windhelm and arrive.'))
yes('a test task is one thread in the forum, titled and with its body',
    th is not None and len(forum.threads) == 1
    and forum.threads[0].name == 'Ride the ferry to Solstheim'
    and forum.threads[0].content == 'Board at Windhelm and arrive.')
yes('  tagged Main by default (#2276: Main only)',
    [t.name for t in th.applied_tags] == ['Main'])
th2, said = run(bot.post_test_task(g, 'Buy a house', 'In Whiterun.', 'main'))
yes('a Main task gets the Main tag (any case)',
    [t.name for t in th2.applied_tags] == ['Main'])
tpath = os.path.join(TMP, 'tasks.json')
dforum = bot.dev_tasks_forum(g, tpath)
dv, said = run(bot.post_test_task(g, 'Fish in Riften', 'At the docks.', 'Dev',
                                  path=tpath))
yes('a hand post tagged Dev goes to #dev-test-tasks (found by its recorded '
    'id), tagged Dev, and not to #test-tasks (Patrick, 12 Oct, on #2276)',
    dv is not None and dforum is not None and dv in dforum.threads
    and [t.name for t in dv.applied_tags] == ['Dev']
    and not [x for x in forum.threads if x.name == 'Fish in Riften']
    and len(forum.threads) == 2)
dforum.name = 'renamed-by-hand'
dv2, said = run(bot.post_test_task(g, 'Fish in Riften', 'Again.', 'dev', path=tpath))
yes('  the same title again (any case of Dev, the forum renamed) is not a '
    'second thread', dv2 is dv and len(dforum.threads) == 1
    and said.startswith('Already'))
again, said = run(bot.post_test_task(g, 'Ride the ferry to Solstheim', 'x'))
yes('the same title again is not a second thread',
    again is th and len(forum.threads) == 2 and said.startswith('Already'))
no, said = run(bot.post_test_task(g, 'x', 'y', 'Live'))
yes('a tag that is not Main or Dev is refused, and nothing is posted',
    no is None and 'Main' in said and 'Dev' in said
    and len(forum.threads) == 2 and len(dforum.threads) == 1)
no, said = run(bot.post_test_task(g, 'x' * 101, 'y'))
yes('a title Discord would refuse is refused first', no is None)
g2, *_ = server()
no, said = run(bot.post_test_task(g2, 'x', 'y'))
yes('before the setup, it says #test-tasks is not a forum yet',
    no is None and 'not a forum yet' in said)
no, said = run(bot.post_test_task(g2, 'x', 'y', 'Dev',
                                  path=os.path.join(TMP, 'never.json')))
yes('  and a Dev one says #dev-test-tasks is not made yet, nothing posted',
    no is None and 'dev-test-tasks is not made yet' in said)
import inspect as _insp  # noqa: E402
_sig_cmd = _insp.signature(bot.test_task_cmd.callback)
yes('/test-task has a tag option, Main or Dev, Main when left out (%s)'
    % list(_sig_cmd.parameters),
    'tag' in _sig_cmd.parameters
    and _sig_cmd.parameters['tag'].default == 'Main'
    and set(getattr(_sig_cmd.parameters['tag'].annotation, '__args__', ()))
    == {'Main', 'Dev'})
_tag_param = [p for p in bot.test_task_cmd.parameters if p.name == 'tag']
yes('  Discord gets it as an optional choice of Main and Dev, every text in '
    'the limits Discord sets',
    len(_tag_param) == 1 and not _tag_param[0].required
    and sorted(c.value for c in _tag_param[0].choices) == ['Dev', 'Main']
    and len(bot.test_task_cmd.description) <= 100
    and all(len(p.description) <= 100 for p in bot.test_task_cmd.parameters))
_src = harness_bot.source()
yes('--post-task --tag takes Main or Dev, Main by default',
    "ap.add_argument('--tag', choices=list(HAND_TAGS), default=TASK_POST_TAG)" in _src
    and bot.TASK_POST_TAG == 'Main' and set(bot.HAND_TAGS) == {'Main', 'Dev'})


# --------------------------------------------------- browsing test tasks --
class QueueThread:
    def __init__(self, tid, title, marks=(), *, pinned=False, replies=False,
                 archived=False, locked=False):
        self.id, self.name = tid, title
        self.flags = SimpleNamespace(pinned=pinned)
        self.message_count = 2 if replies else 1
        self.archived, self.locked = archived, locked
        self.fetch_message = AsyncMock(return_value=SimpleNamespace(
            pinned=False, reactions=[SimpleNamespace(emoji=mark, count=1) for mark in marks]))


def read_queue(guild, **choices):
    interaction = SimpleNamespace(
        guild=guild, user=Mock(spec=discord.Member),
        response=SimpleNamespace(defer=AsyncMock(), send_message=AsyncMock()),
        followup=SimpleNamespace(send=AsyncMock()))
    run(bot.test_queue_cmd.callback(interaction, **choices))
    return interaction


queue_threads = [
    QueueThread(100, 'Trade a horse'),
    QueueThread(101, 'Trade before travel', ['\u2705'], replies=True),
    QueueThread(102, 'Trade a key', ['\u274c']),
    QueueThread(103, 'Trade a sword', ['\U0001f4cc']),
    QueueThread(104, 'Trade on foot', ['\u2705', '\u274c']),
    QueueThread(105, 'Trade in town', pinned=True),
    QueueThread(106, 'Trade clothing', replies=True),
    QueueThread(107, 'Trade an apple'),
    QueueThread(108, 'Look at the inventory'),
    QueueThread(109, 'Trade a mule'),
    QueueThread(110, 'Trade a helmet', archived=True),
    QueueThread(111, 'Trade a shield', locked=True),
]
main_queue = SimpleNamespace(
    id=1000, name=bot.TASKS_NAME, type=discord.ChannelType.forum,
    threads=queue_threads, permissions_for=Mock(return_value=discord.Permissions(
        view_channel=True, read_message_history=True)))
dev_thread = QueueThread(200, 'Staff check')
dev_queue = SimpleNamespace(
    id=1001, name='renamed-dev-forum', type=discord.ChannelType.forum,
    threads=[dev_thread], permissions_for=Mock(return_value=discord.Permissions.none()))
queue_guild = SimpleNamespace(id=1, channels=[main_queue, dev_queue],
                              get_channel=lambda cid: dev_queue if cid == dev_queue.id else None)
old_setup = bot.SETUP_STATE
bot.SETUP_STATE = os.path.join(TMP, 'queue-setup.json')
bot._state_write(bot.SETUP_STATE, {'guilds': {'1': {'dev_tasks_id': dev_queue.id}}})
try:
    read = read_queue(queue_guild, search='TRADE', order='Oldest')
    shown, = read.followup.send.await_args.args
    yes('test queue takes eight matching active posts, with ready work above results',
        'Page 1 of 2' in shown and '9 matching' in shown
        and shown.index('<#100>') < shown.index('<#107>') < shown.index('<#101>')
        and all('<#%d>' % tid not in shown for tid in (108, 109, 110, 111))
        and sum(thread.fetch_message.await_count for thread in queue_threads) == 8)
    yes('  the result labels preserve failed, partial, passed and conflicting marks',
        all(row in shown for row in (
            '<#101> · Passed · replies', '<#102> · Failed', '<#103> · Partial',
            '<#104> · Conflicting results', '<#105> · Partial',
            '<#106> · Unmarked with replies', '<#107> · Ready to test')))
    yes('  the replies are private and cannot mention viewers',
        read.response.defer.await_args.kwargs.get('ephemeral') is True
        and read.followup.send.await_args.kwargs.get('ephemeral') is True
        and read.followup.send.await_args.kwargs['allowed_mentions'].to_dict() == {'parse': []})

    read = read_queue(queue_guild, search='trade', page=2)
    second, = read.followup.send.await_args.args
    yes('  the second page uses the default newest ordering and the same search',
        'Page 2 of 2' in second and '<#100>' in second and '<#109>' not in second
        and sum(thread.fetch_message.await_count for thread in queue_threads) == 9)
    read = read_queue(queue_guild, search='trade mule')
    yes('  a multi-word title search finds the post on a single page',
        '1 matching' in read.followup.send.await_args.args[0]
        and '<#109> · Ready to test' in read.followup.send.await_args.args[0])

    read = read_queue(queue_guild, search='trade', page=3)
    yes('  a page past the end tells the viewer how far they can go',
        '2 pages' in read.response.send_message.await_args.args[0]
        and not read.followup.send.await_count)

    read = read_queue(queue_guild, server='Dev')
    yes('  a viewer without Dev access gets no private task titles or lookups',
        'do not have access' in read.response.send_message.await_args.args[0]
        and not read.followup.send.await_count and not dev_thread.fetch_message.await_count)
    dev_queue.permissions_for.return_value = discord.Permissions(view_channel=True)
    read = read_queue(queue_guild, server='Dev')
    yes('  without Read Message History a viewer gets no test results',
        'do not have access' in read.response.send_message.await_args.args[0]
        and not dev_thread.fetch_message.await_count)
    dev_queue.permissions_for.return_value = discord.Permissions(
        view_channel=True, read_message_history=True)
    read = read_queue(queue_guild, server='Dev')
    dev_shown, = read.followup.send.await_args.args
    yes('  a permitted viewer sees Dev from its recorded forum ID after a rename',
        'Dev test queue' in dev_shown and '<#200>' in dev_shown and '<#100>' not in dev_shown)
    dev_thread.fetch_message.side_effect = Refused()
    read = read_queue(queue_guild, server='Dev')
    yes('  a result read refused by Discord never appears ready',
        '<#200> · Status unavailable' in read.followup.send.await_args.args[0])
finally:
    bot.SETUP_STATE = old_setup


# --------------------------------------------------- 4. known issues --
ISSUES = {}
COMMENTS = {}
TIMELINE = {}


UPD = [0]
HOUR = ['2026-10-12T06']


def issue(num, title, label, state='open', reason=None, pr=False,
          closed_at=None):
    UPD[0] += 1
    row = {'number': num, 'title': title, 'state': state,
           'state_reason': reason, 'closed_at': closed_at,
           'updated_at': HOUR[0] + ':%02d:%02dZ' % divmod(UPD[0], 60),
           'html_url': 'https://github.com/ThornswoodRP/Thornswood/issues/%d' % num,
           'repository_url': 'https://api.github.com/repos/ThornswoodRP/Thornswood',
           'labels': [{'name': l} for l in label]}
    if pr:
        row['pull_request'] = {}
    ISSUES[num] = row


# A finding's "Known issue:" comment, which whoever files it writes with it
# (12 Nov: the bot no longer posts a finding that has none, under its title
# cut to fit and a fixed line). The stand-in writes one, the issue's title
# and a line of what happens, for every labelled issue not in NO_KNOWN.
NO_KNOWN = set()


def known_comment(num):
    row = ISSUES.get(num) or {}
    names = [l['name'] for l in row.get('labels') or []]
    if num in NO_KNOWN or not any(n.endswith(' Findings') for n in names):
        return []
    return [{'body': 'Known issue: %s\nWhat happens: %s.' % (row['title'], row['title']),
             'created_at': '2026-10-01T00:00:00Z'}]


ASKED = []
# Labels whose open-issue list GitHub answers with nothing, though the issues
# are still open and labelled (#3438), and issues GitHub has deleted.
EMPTY_LISTS = set()
DELETED = set()


# What the stand-in GitHub calls the repository now (#5184).
REPO_NOW = [bot.KNOWN_REPO]


def gh(url):
    ASKED.append(url)
    path = url.split('?')[0]
    if path.endswith('/repos/' + bot.KNOWN_REPO):
        return {'full_name': REPO_NOW[0]}
    if path.endswith('/comments'):
        num = int(path.split('/')[-2])
        return known_comment(num) + COMMENTS.get(num, [])
    if path.endswith('/timeline'):
        return TIMELINE.get(int(path.split('/')[-2]), [])
    if '/issues/' in path:
        num = int(path.rsplit('/', 1)[1])
        if num in DELETED:
            raise bot.urllib.error.HTTPError(url, 410, 'Gone', {}, None)
        return ISSUES[num]
    if 'state=all' in url:
        since = bot.urllib.parse.unquote(url.split('since=')[1].split('&')[0])
        return sorted([r for r in ISSUES.values() if r['updated_at'] >= since],
                      key=lambda r: r['updated_at'])
    if 'state=closed' in url:
        since = bot.urllib.parse.unquote(url.split('since=')[1].split('&')[0])
        return [r for r in ISSUES.values() if r['state'] == 'closed'
                and r['updated_at'] >= since]
    label = bot.urllib.parse.unquote(url.split('labels=')[1])
    if label in EMPTY_LISTS:
        return []
    return [r for r in ISSUES.values() if r['state'] == 'open'
            and label in [l['name'] for l in r['labels']]]


g, tasks, results, play, staff = server()
run(bot.channel_setup(g, apply=True, path=os.path.join(TMP, 'known.json')))
kf = bot._channel_named(g, 'known-issues', ('forum',))
tf = bot._channel_named(g, 'test-tasks', ('forum',))
me = g.me
issue(10, 'Ferry sinks', ['Dev Findings'])
issue(11, 'Gold resets', ['Main Findings', 'Dev Findings'])
issue(12, 'A PR', ['Dev Findings'], pr=True)
issue(13, 'Unlabelled', ['bug'])
st = {'issues': {'99': {'message_id': 5, 'channel_id': 1234, 'closed': None}}}
saves = []
posted, edited, removed = run(bot.known_issues_once(kf, st, gh,
                      save=lambda s: saves.append(len(s['issues'])), me_id=me.id))
yes('one forum POST per open labelled issue, never for a pull request or an '
    'unlabelled issue, one only for an issue with both labels',
    posted == [10, 11] and len(kf.threads) == 2)
yes('  each titled with the issue\'s title, tagged Dev or Main by its label',
    [(th.name, sorted(x.name for x in th.applied_tags)) for th in kf.threads]
    == [('Ferry sinks', ['Dev']), ('Gold resets', ['Dev', 'Main'])])
yes('  with no issue number and no link in the post',
    not any('#1' in th.content or 'http' in th.content for th in kf.threads))
yes('  saved straight after each post', saves == [1, 2])
yes('  and a record from the old text channel is forgotten, not acted on',
    '99' not in st['issues'] and removed == [])
posted, edited, removed = run(bot.known_issues_once(kf, st, gh, me_id=me.id))
yes('a second pass posts and removes nothing', posted == [] and removed == []
    and len(kf.threads) == 2)
# A finding that ends with no post is read once at each update time, not on
# every pass (#5184: only posted issues were remembered).
issue(14, 'Has a task', ['Dev Findings'])
COMMENTS[14] = [{'body': 'Test task: Ride the ferry\nServer: Dev\nBoard it.\nYou arrive.'}]
run(bot.known_issues_once(kf, st, gh, me_id=me.id))
ASKED[:] = []
posted, edited, removed = run(bot.known_issues_once(kf, st, gh, me_id=me.id))
yes('a finding with a test task is not posted, and the next pass does not read '
    'its comments again',
    posted == [] and len(kf.threads) == 2
    and not [u for u in ASKED if '/issues/14/comments' in u]
    and st['known_read'].get('14', '').startswith(ISSUES[14]['updated_at']))
issue(14, 'Has a task', ['Dev Findings'])
ASKED[:] = []
run(bot.known_issues_once(kf, st, gh, me_id=me.id))
yes('  it is read again once it changes', [u for u in ASKED if '/issues/14/comments' in u] != [])
path = os.path.join(TMP, 'known-issues.json')
bot._known_save(dict(st, _dirty=True), path)
posted, _, _ = run(bot.known_issues_once(kf, bot._state_read(path), gh, me_id=me.id))
yes('after a restart, read back from the file, nothing is posted again',
    posted == [] and len(kf.threads) == 2)
st3 = {'issues': {'10': st['issues']['10']}}
posted, _, _ = run(bot.known_issues_once(kf, st3, gh, me_id=me.id))
yes('a post that never reached the file is found again by its title, not doubled',
    posted == [11] and len(kf.threads) == 2
    and st3['issues']['11']['thread_id'] == st['issues']['11']['thread_id'])

issue(10, 'Ferry sinks', ['Dev Findings'], state='closed', reason='completed',
      closed_at='2026-10-12T05:00:00Z')
issue(11, 'Gold resets', ['bug'])
posted, edited, removed = run(bot.known_issues_once(kf, st, gh, me_id=me.id))
yes('fixed and closed, or the findings label taken off: the post is DELETED',
    sorted(removed) == [10, 11] and kf.threads == []
    and [c for c in g.calls if c[0] == 'delete_thread'])
issue(10, 'Ferry sinks', ['Dev Findings'])
posted, edited, removed = run(bot.known_issues_once(kf, st, gh, me_id=me.id))
yes('reopened as a finding: a post again', posted == [10] and len(kf.threads) == 1)


# --------------------------------------------- 5. automatic test tasks --
ISSUES.clear()
tst = {}
issue(30, 'Old fix', ['Dev Findings'], state='closed', reason='completed',
      closed_at='2026-10-01T00:00:00Z')
posted, edited, removed = run(bot.test_tasks_once(tf, tst, gh, me_id=me.id,
                                         now='2026-10-12T04:00:00Z'))
yes('the first pass only sets the start: nothing closed before it is posted',
    posted == [] and tst['since'] == '2026-10-12T04:00:00Z' and tf.threads == [])
issue(31, 'Ferry sinks', ['Dev Findings'], state='closed', reason='completed',
      closed_at='2026-10-12T05:00:00Z')
COMMENTS[31] = [{'body': 'Fixed in the gamemode.'},
                {'body': 'Test task: Ride the ferry to Solstheim\nServer: Dev\n'
                         'Board at Windhelm and ride across.\nYou arrive dry.'}]
issue(32, 'Gold resets', ['Dev Findings'], state='closed', reason='completed',
      closed_at='2026-10-12T05:01:00Z')
issue(33, 'Tooling only', ['area: Release'], state='closed', reason='completed',
      closed_at='2026-10-12T05:02:00Z')
issue(34, 'Will not do', ['Dev Findings'], state='closed', reason='not_planned',
      closed_at='2026-10-12T05:03:00Z')
issue(35, 'Launcher fix', ['area: Launcher'], state='closed', reason='completed',
      closed_at='2026-10-12T05:04:00Z')
COMMENTS[35] = [{'body': 'test task: Open the server list\nIt opens on your server.'}]
posted, edited, removed = run(bot.test_tasks_once(tf, tst, gh, me_id=me.id))
by = dict((th.name, th) for th in tf.threads)
yes('a fixed issue becomes a test task post, titled and written from its '
    '"Test task:" comment, tagged Main even though its Server line says Dev, '
    'and the Server line is not in the body',
    'Ride the ferry to Solstheim' in by
    and by['Ride the ferry to Solstheim'].content
    == 'Board at Windhelm and ride across.\nYou arrive dry.'
    and [x.name for x in by['Ride the ferry to Solstheim'].applied_tags] == ['Main'])
yes('  a fixed finding with no such comment gets no post: the bot never writes '
    'one of its own from the issue title (until 12 Nov it did, cut to 45 '
    'characters, with "Check it on main" and no steps)',
    'Gold resets' not in by and not [th for th in tf.threads
                                     if th.content.startswith('This was fixed')])
yes('  any fixed issue with a "Test task:" comment is posted, finding or not, '
    'tagged Main with no Server line at all',
    'Open the server list' in by
    and [x.name for x in by['Open the server list'].applied_tags] == ['Main'])
yes('  every test task the bot posted carries the one tag Main',
    all([x.name for x in th.applied_tags] == ['Main'] for th in tf.threads))
yes('  but not a fixed issue with neither, and not one closed as not planned',
    'Tooling only' not in by and 'Will not do' not in by
    and sorted(posted) == [31, 35])
posted, edited, removed = run(bot.test_tasks_once(tf, tst, gh, me_id=me.id))
yes('a second pass posts nothing twice', posted == [] and len(tf.threads) == 2)
ASKED[:] = []
run(bot.test_tasks_once(tf, tst, gh, me_id=me.id))
yes('a fixed issue with no test task is read once, not on every pass: no '
    'comments are read when nothing changed (#4331, #5184)',
    not [u for u in ASKED if u.split('?')[0].endswith('/comments')]
    and tst['tasks_read'].get('33', '').startswith(ISSUES[33]['updated_at']))
COMMENTS[33] = [{'body': 'Test task: Build the release\nIt builds.'}]
issue(33, 'Tooling only', ['area: Release'], state='closed', reason='completed',
      closed_at='2026-10-12T05:02:00Z')
posted, edited, removed = run(bot.test_tasks_once(tf, tst, gh, me_id=me.id))
yes('  and once it changes it is read again, and posted when it has one now',
    posted == [33] and '33' not in tst['tasks_read'])
_e = bot.urllib.error.HTTPError(bot.GITHUB_API + '/repos/o/r/issues/5/comments?per_page=100&page=1',
                                403, 'Forbidden', {}, None)
yes('a failed pass names the call: its status and the path asked, never the host',
    bot.pass_failure(_e) == 'HTTPError 403 on /repos/o/r/issues/5/comments?per_page=100&page=1'
    and bot.pass_failure(ValueError('x')) == 'ValueError')
_src5 = _insp.getsource(bot.watch_known_issues)
yes('  and what it read before it failed is saved',
    "log('known issues: a pass failed: %s' % pass_failure(e))" in _src5
    and _src5.index('pass_failure(e)') < _src5.index('_known_save(state)', _src5.index('pass_failure(e)')))
issue(31, 'Ferry sinks', ['Main Findings'])
posted, edited, removed = run(bot.test_tasks_once(tf, tst, gh, me_id=me.id))
yes('a reopened issue loses its test task post',
    removed == [31] and 'Ride the ferry to Solstheim' not in [th.name for th in tf.threads])


# ----------------------------- 6. written for testers, and kept up to date --
ISSUES.clear()
COMMENTS.clear()
g, tasks, results, play, staff = server()
run(bot.channel_setup(g, apply=True, path=os.path.join(TMP, 'written.json')))
kf = bot._channel_named(g, 'known-issues', ('forum',))
tf = bot._channel_named(g, 'test-tasks', ('forum',))
issue(40, 'Smith', ['Main Findings'])
COMMENTS[40] = [{'body': 'Known issue: Forge tells you to wait for ever\n'
                         'At a forge the bar fills and never finishes.\nLeave and come back.',
                 'created_at': '2026-10-12T06:00:00Z'}]
issue(41, 'Bare title', ['Dev Findings'])
NO_KNOWN.add(41)
st = {}
posted, edited, removed = run(bot.known_issues_once(kf, st, gh, me_id=me.id))
by = dict((th.name, th) for th in kf.threads)
yes('a "Known issue:" comment gives the post its short title and its body, '
    'tagged by the label',
    'Forge tells you to wait for ever' in by
    and by['Forge tells you to wait for ever'].content
    == 'At a forge the bar fills and never finishes.\nLeave and come back.'
    and [x.name for x in by['Forge tells you to wait for ever'].applied_tags] == ['Main'])
yes('  an issue with none gets no post: the bot never makes one up from its '
    'title and a fixed line (Patrick, 12 Nov)',
    'Bare title' not in by and len(kf.threads) == 1 and 41 not in posted)
before = len([u for u in ASKED if u.endswith('/comments') or '/comments?' in u])
posted, edited, removed = run(bot.known_issues_once(kf, st, gh, me_id=me.id))
after = len([u for u in ASKED if u.endswith('/comments') or '/comments?' in u])
yes('an issue GitHub says did not change is not read again (no comment calls)',
    after == before and posted == edited == removed == [])
COMMENTS[41] = [{'body': 'Known issue: Doors stick shut in Riften\nServer: Dev\n'
                         'Some Riften doors will not open.', 'created_at': '2026-10-12T06:01:00Z'}]
issue(41, 'Bare title', ['Dev Findings'])
posted, edited, removed = run(bot.known_issues_once(kf, st, gh, me_id=me.id))
yes('a comment written later posts it, under the comment\'s own title and body',
    posted == [41] and edited == [] and len(kf.threads) == 2
    and 'Doors stick shut in Riften' in [th.name for th in kf.threads]
    and 'Bare title' not in [th.name for th in kf.threads])

tst = {}
run(bot.test_tasks_once(tf, tst, gh, me_id=me.id, now='2026-10-12T05:00:00Z'))
issue(50, 'Old one', ['area: Launcher'], state='closed', reason='completed',
      closed_at='2026-10-11T20:00:00Z')
COMMENTS[50] = [{'body': 'Test task: Server list opens on yours\nOpen the launcher.',
                 'created_at': '2026-10-12T05:30:00Z'}]
issue(51, 'Ferry sinks at the dock', ['Dev Findings'], state='closed',
      reason='completed', closed_at='2026-10-12T05:10:00Z')
COMMENTS[51] = [{'body': 'Test task:\nServer: Dev\nRide the ferry.',
                 'created_at': '2026-10-12T05:11:00Z'}]
posted, edited, removed = run(bot.test_tasks_once(tf, tst, gh, me_id=me.id))
names = [th.name for th in tf.threads]
yes('a closed issue whose "Test task:" comment was written after the start gets '
    'a post, however long ago it closed',
    50 in posted and 'Server list opens on yours' in names)
yes('  and "Test task:" with nothing after it never takes the issue\'s own '
    'title (the rules refuse an empty one; test-post-rules.py)',
    'Ferry sinks at the dock' not in names)
th51 = [th for th in tf.threads if th.content == 'Ride the ferry.']
yes('  its "Server: Dev" line is read and dropped: the body is only what '
    'follows it, and the tag is Main',
    len(th51) == 1 and th51[0].content == 'Ride the ferry.'
    and [x.name for x in th51[0].applied_tags] == ['Main'])
COMMENTS[51].append({'body': 'Test task: Ferry crossing works\nServer: Main\n'
                             '1. Board the ferry.\nWhat should happen: you arrive.',
                     'created_at': '2026-10-12T06:30:00Z'})
issue(51, 'Ferry sinks at the dock', ['Dev Findings'], state='closed',
      reason='completed', closed_at='2026-10-12T05:10:00Z')
posted, edited, removed = run(bot.test_tasks_once(tf, tst, gh, me_id=me.id))
th51 = [th for th in tf.threads if th.name == 'Ferry crossing works']
yes('a rewritten "Test task:" comment EDITS its post: title, body and tag',
    edited == [51] and posted == [] and len(th51) == 1
    and th51[0].content == '1. Board the ferry.\nWhat should happen: you arrive.'
    and [x.name for x in th51[0].applied_tags] == ['Main'])

# A post made by hand (--post-task) is adopted, then brought up to date.
made = run(tf.create_thread(name='Long hand title', content='old', applied_tags=[]))
kpath = os.path.join(TMP, 'adopt.json')
bot._state_write(kpath, dict(tst))
said = bot.adopt_task(60, made.id, path=kpath)
issue(60, 'Hand posted', ['Dev Findings'], state='closed', reason='completed',
      closed_at='2026-10-11T21:00:00Z')
COMMENTS[60] = [{'body': 'Test task: Short and clear\nDo the thing.',
                 'created_at': '2026-10-11T21:00:00Z'}]
st5 = bot._state_read(kpath)
posted, edited, removed = run(bot.test_tasks_once(tf, st5, gh, me_id=me.id))
yes('an adopted hand post belongs to its issue and is edited to its test task',
    'now owns test task post' in said and 60 in edited
    and made.name == 'Short and clear' and made.content == 'Do the thing.'
    and [x.name for x in made.applied_tags] == ['Main'])


# ------------------------------- 7. what the plain bodies say, under main --
nobody = {'title': 'Ferry', 'labels': [{'name': 'Dev Findings'}]}
yes('the bot writes no words of its own: a fixed finding with no test task '
    'has no post, and a known issue with no comment none either (12 Nov)',
    bot.task_post_of(nobody, []) is None and bot.known_of(nobody, []) is None)
yes('a "Test task:" comment with no body keeps no body, for the rules to refuse',
    bot.test_task_of(nobody, [{'body': 'Test task: Ferry\nServer: Dev',
                               'created_at': 'x'}])
    == ('Ferry', '', 'x'))
FOOT = '\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_\n'
yes('the Claude Code line GitHub puts under a comment is not in the test '
    'task, Main or Dev',
    bot.test_task_of(nobody, [{'body': 'Test task: Ferry\nServer: Main\n1. Ride.' + FOOT,
                               'created_at': 'x'}])
    == ('Ferry', '1. Ride.', 'x')
    and bot.dev_task_of(nobody, [{'body': 'Test task: Ferry\r\nServer: Dev\r\n1. Ride.'
                                  + FOOT.replace('\n', '\r\n'),
                                  'created_at': 'y'}], 'a')[1] == '1. Ride.'
    and bot.known_of(nobody, [{'body': 'Known issue: X\nY' + FOOT}])[1] == 'Y')
yes('a rule inside a test task, with no Claude Code line under it, is kept',
    bot.test_task_of(nobody, [{'body': 'Test task: Ferry\n1. Ride.\n---\n2. Back.',
                               'created_at': 'x'}])[1] == '1. Ride.\n---\n2. Back.')
yes('known issues keep their Dev and Main tags: by label, or by a "Server:" '
    'line under "Known issue:"',
    bot.known_of(nobody, [{'body': 'Known issue: X\nY'}])[2] == ['Dev']
    and bot.known_of(nobody, [{'body': 'Known issue: X\nServer: Main\nY'}])[2]
    == ['Main'])


# ------------------------- 8. posts of an older form are written again --
# Records written by the bot before TASK_FORM and KNOWN_FORM: no form in
# them, posts tagged and worded the old way, and GitHub says nothing changed.
ISSUES.clear()
COMMENTS.clear()
g, tasks, results, play, staff = server()
run(bot.channel_setup(g, apply=True, path=os.path.join(TMP, 'form.json')))
kf = bot._channel_named(g, 'known-issues', ('forum',))
tf = bot._channel_named(g, 'test-tasks', ('forum',))


def tag(forum, name):
    return [bot.task_tag_of(forum, name)]


issue(70, 'Doors stick', ['Dev Findings'], state='closed', reason='completed',
      closed_at='2026-10-12T05:20:00Z')
COMMENTS[70] = [{'body': 'Test task: Riften doors open\nServer: Dev\nOpen a door.',
                 'created_at': '2026-10-12T05:21:00Z'}]
issue(71, 'Gold resets', ['Dev Findings'], state='closed', reason='completed',
      closed_at='2026-10-12T05:22:00Z')
issue(72, 'Old close', ['area: Launcher'], state='closed', reason='completed',
      closed_at='2026-10-11T20:00:00Z')
COMMENTS[72] = [{'body': 'Test task: List opens\nServer: Dev\nOpen it.',
                 'created_at': '2026-10-11T20:00:00Z'}]
ISSUES[72]['updated_at'] = '2026-10-11T20:00:00Z'   # untouched since the start
issue(73, 'Smith', ['Dev Findings'])
issue(74, 'Forge', ['Main Findings'])
COMMENTS[74] = [{'body': 'Known issue: Forge waits for ever\nIt never finishes.'}]
old_known = 'Known on Dev. The team is working on it; this post goes when it is fixed.'
th70 = run(tf.create_thread(name='Riften doors open', content='Open a door.',
                            applied_tags=tag(tf, 'Dev')))
th71 = run(tf.create_thread(name='Gold resets', applied_tags=tag(tf, 'Dev'),
                            content='This was fixed. Check it on Dev, and say in '
                                    '#test-findings if it still happens.'))
th72 = run(tf.create_thread(name='List opens', content='Open it.',
                            applied_tags=tag(tf, 'Dev')))
th73 = run(kf.create_thread(name='Smith', content=old_known,
                            applied_tags=tag(kf, 'Dev')))
th74 = run(kf.create_thread(name='Forge waits for ever', content='It never finishes.',
                            applied_tags=tag(kf, 'Main')))


def old(th, num, tags):
    return {'thread_id': th.id, 'channel_id': th.forum.id,
            'sig': bot._sig(th.name, th.content, tags),
            'updated': ISSUES[num]['updated_at']}


fst = {'since': '2026-10-12T05:00:00Z',
       'tasks': {'70': old(th70, 70, ['Dev']), '71': old(th71, 71, ['Dev']),
                 '72': old(th72, 72, ['Dev'])},
       'issues': {'73': old(th73, 73, ['Dev']), '74': old(th74, 74, ['Main'])}}
fpath = os.path.join(TMP, 'form-state.json')
bot._known_save(dict(fst, _dirty=True), fpath)
fst = bot._state_read(fpath)
posted, edited, removed = run(bot.test_tasks_once(tf, fst, gh, me_id=me.id))
yes('after the update, a test task posted tagged Dev is EDITED to Main on the '
    'next pass, though its issue did not change, and nothing is posted twice',
    sorted(edited) == [70, 72] and posted == []
    and all([x.name for x in th.applied_tags] == ['Main'] for th in (th70, th72)))
yes('  a post of the bot\'s own plain line, with no test task behind it, comes '
    'down (12 Nov: the bot writes no test task of its own); a written body is '
    'kept as it was',
    removed == [71] and th71 not in tf.threads and len(tf.threads) == 2
    and th70.content == 'Open a door.' and th72.content == 'Open it.')
yes('  including a post whose issue closed before the start (adopted)',
    72 in edited)
yes('  and every record now holds the new form',
    all(r.get('form') == bot.TASK_FORM for r in fst['tasks'].values()))
posted, edited, removed = run(bot.known_issues_once(kf, fst, gh, me_id=me.id))
yes('a known issue with the old plain line is EDITED to its "Known issue:" '
    'comment\'s words, once, and keeps its Dev tag',
    edited == [73] and posted == [] and removed == [] and len(kf.threads) == 2
    and th73.content == 'What happens: Smith.'
    and [x.name for x in th73.applied_tags] == ['Dev'])
yes('  a known issue with a written body is not edited, but its record takes '
    'the new form',
    th74.content == 'It never finishes.'
    and [x.name for x in th74.applied_tags] == ['Main']
    and all(r.get('form') == bot.KNOWN_FORM for r in fst['issues'].values()))
bot._known_save(dict(fst, _dirty=True), fpath)
fst = bot._state_read(fpath)
before = len([u for u in ASKED if '/comments' in u])
calls = len(g.calls)
t_out = run(bot.test_tasks_once(tf, fst, gh, me_id=me.id))
k_out = run(bot.known_issues_once(kf, fst, gh, me_id=me.id))
after = len([u for u in ASKED if '/comments' in u])
yes('once rewritten and read back after a restart, the next passes read no '
    'comments and change nothing: the rewrite happens once, not every pass',
    after == before and len(g.calls) == calls
    and t_out == ([], [], []) and k_out == ([], [], []))


# -------------------------------------------- 9. #dev-test-tasks, the setup --
def names(forum):
    return [th.name for th in forum.threads]


def before_dev(path):
    """A server set up before #dev-test-tasks existed: the first two steps
       done and recorded, no dev forum and no record of one."""
    g, tasks, results, play, staff = server()
    run(bot.channel_setup(g, apply=True, path=path))
    run(bot._channel_named(g, 'dev-test-tasks', ('forum',)).delete())
    stj = json.load(open(path))
    for k in ('dev_tasks', 'dev_tasks_id'):
        stj['guilds']['1'].pop(k, None)
    json.dump(stj, open(path, 'w'))
    g.calls = []
    return g, play


dpath = os.path.join(TMP, 'dev-setup.json')
g, tasks, results, play, staff = server()
staffcat = g.get_channel(STAFF_ID)
said = run(bot.channel_setup(g, apply=False, path=dpath))
text = '\n'.join(said)
yes('a preview says it would make #dev-test-tasks in Staff with the category\'s '
    '4 overwrites, and asks Discord for nothing',
    g.calls == [] and 'would make the forum #dev-test-tasks in Staff with the '
    'category\'s 4 permission overwrite(s)' in text)
run(bot.channel_setup(g, apply=True, path=dpath))
df = bot._channel_named(g, 'dev-test-tasks', ('forum',))
yes('the apply makes #dev-test-tasks as a FORUM in the category with Patrick\'s '
    'id (Staff), tagged Dev only',
    df is not None and df.category is staffcat
    and [t.name for t in df.available_tags] == ['Dev'])
others = [t for t in staffcat.overwrites if t is not g.me]
yes('  staff only like the category: its overwrites copied exactly, as new '
    'objects, so @everyone and Playtester cannot see it',
    set(df.overwrites) == set(staffcat.overwrites)
    and all(pairs({t: df.overwrites[t]}) == pairs({t: staffcat.overwrites[t]})
            for t in others)
    and not any(df.overwrites[t] is staffcat.overwrites[t] for t in df.overwrites)
    and df.overwrites[play].view_channel is False
    and df.overwrites[g.default_role].view_channel is False)
yes('  the bot may see it, post, reply, delete its posts and read them back',
    all(getattr(df.overwrites[g.me], n) is True for n in bot.FORUM_BOT_NEEDS))
rec = json.load(open(dpath))['guilds']['1']
yes('  its id is recorded as dev_tasks_id',
    rec.get('dev_tasks_id') == df.id and rec.get('dev_tasks'))
g.calls = []
said = run(bot.channel_setup(g, apply=True, path=dpath))
yes('a second run does nothing and says it was already done',
    g.calls == [] and said[0].startswith('already done'))
df.name = 'dev-tests'
said = run(bot.channel_setup(g, apply=True, path=dpath))
yes('renamed by hand, it is found again by its id: nothing is made, no second forum',
    g.calls == [] and said[0].startswith('already done')
    and bot.dev_tasks_forum(g, dpath) is df
    and len([c for c in staffcat.channels if bot._kind(c) == 'forum']) == 1)
run(df.delete())
g.calls = []
said = run(bot.channel_setup(g, apply=True, path=dpath))
df2 = bot.dev_tasks_forum(g, dpath)
yes('deleted by hand, the next apply says the recorded one is gone, makes it '
    'again and records the new id',
    'is not on the server any more' in '\n'.join(said)
    and df2 is not None and df2 is not df
    and [c[0] for c in g.calls] == ['create_forum']
    and json.load(open(dpath))['guilds']['1']['dev_tasks_id'] == df2.id)

opath = os.path.join(TMP, 'dev-before.json')
g, play = before_dev(opath)
tf = bot._channel_named(g, 'test-tasks', ('forum',))
tf.overwrites[g.me] = OW(view_channel=True, send_messages=True,
                         send_messages_in_threads=True, manage_threads=True,
                         embed_links=True)
said = run(bot.channel_setup(g, apply=False, path=opath))
yes('on a server set up before, a preview says only the #dev-test-tasks step, '
    'and asks Discord for nothing',
    g.calls == [] and len(said) == 2
    and 'would make the forum #dev-test-tasks' in said[0])
run(bot.channel_setup(g, apply=True, path=opath))
d = bot.dev_tasks_forum(g, opath)
yes('  the apply makes that forum and nothing else',
    [c[0] for c in g.calls] == ['create_forum'] and d is not None)
yes('  the bot\'s overwrite there is its #test-tasks one, with the forum rights on',
    d.overwrites[g.me].embed_links is True
    and all(getattr(d.overwrites[g.me], n) is True for n in bot.FORUM_BOT_NEEDS))

apath = os.path.join(TMP, 'dev-adopt.json')
g, play = before_dev(apath)
staffcat = g.get_channel(STAFF_ID)
by_hand = Channel(g, 'dev-test-tasks', 'forum', staffcat, 7,
                  {g.default_role: OW(view_channel=False),
                   g.me: OW(view_channel=True)}, [])
said = run(bot.channel_setup(g, apply=True, path=apath))
yes('a #dev-test-tasks forum already in Staff is taken as it is: no second '
    'forum, its id recorded, the Dev tag and the bot\'s rights added, the rest '
    'of its overwrites left alone',
    not [c for c in g.calls if c[0] == 'create_forum']
    and bot.dev_tasks_forum(g, apath) is by_hand
    and [t.name for t in by_hand.available_tags] == ['Dev']
    and all(getattr(by_hand.overwrites[g.me], n) is True for n in bot.FORUM_BOT_NEEDS)
    and by_hand.overwrites[g.default_role].view_channel is False)

tpath = os.path.join(TMP, 'dev-text.json')
g, play = before_dev(tpath)
Channel(g, 'dev-test-tasks', 'text', g.get_channel(STAFF_ID), 7)
said = run(bot.channel_setup(g, apply=True, path=tpath))
yes('a text #dev-test-tasks in Staff is said, and nothing is made or recorded',
    'is not a forum' in '\n'.join(said) and g.calls == []
    and not json.load(open(tpath))['guilds']['1'].get('dev_tasks_id'))

npath = os.path.join(TMP, 'dev-nocat.json')
g, *_ = server(staff_category=False)
said = run(bot.channel_setup(g, apply=True, path=npath))
yes('a server with no category of that id is told so: the first steps are '
    'done, and #dev-test-tasks is not made or recorded',
    'there is no category with id %d' % STAFF_ID in '\n'.join(said)
    and bot._channel_named(g, 'dev-test-tasks') is None
    and bot._channel_named(g, 'known-issues', ('forum',)) is not None
    and not json.load(open(npath))['guilds']['1'].get('dev_tasks_id'))


# ------------------------- 10. dev test tasks, and the move to #test-tasks --
ISSUES.clear()
COMMENTS.clear()
HOUR[0] = '2026-10-13T07'
UPD[0] = 0


def tick():
    UPD[0] += 1
    return HOUR[0] + ':%02d:%02dZ' % divmod(UPD[0], 60)


def bump(num, **k):
    ISSUES[num].update(k)
    ISSUES[num]['updated_at'] = tick()


def comments_read():
    return len([u for u in ASKED if '/comments' in u])


def task(title, server, *lines):
    return {'body': '\n'.join(['Test task: ' + title]
                              + (['Server: ' + server] if server else [])
                              + list(lines)),
            'created_at': tick()}


g, tasks, results, play, staff = server()
run(bot.channel_setup(g, apply=True, path=os.path.join(TMP, 'devpass.json')))
tf = bot._channel_named(g, 'test-tasks', ('forum',))
df = bot._channel_named(g, 'dev-test-tasks', ('forum',))
me = g.me
ds = {}


def both(state=None):
    s = ds if state is None else state
    t = run(bot.test_tasks_once(tf, s, gh, me_id=me.id))
    d = run(bot.dev_tasks_once(df, s, gh, me_id=me.id))
    return t, d


run(bot.test_tasks_once(tf, ds, gh, me_id=me.id, now='2026-10-13T06:59:00Z'))
run(bot.dev_tasks_once(df, ds, gh, me_id=me.id, now='2026-10-13T06:59:30Z'))
yes('the first dev pass only sets the day #dev-test-tasks began',
    ds.get('dev_since') == '2026-10-13T06:59:30Z' and df.threads == [])

COMMENTS[80] = [{'body': 'Test task: Old dev ask\nServer: Dev\nDo it.',
                 'created_at': '2026-10-11T20:00:00Z'}]
issue(80, 'Old one', ['Dev Findings'])
COMMENTS[81] = [{'body': 'Fixed on the branch.', 'created_at': tick()},
                task('Ferry lag on dev', 'Dev', '1. Ride the ferry.',
                     'What should happen: no stutter.')]
issue(81, 'Ferry stutters', ['Dev Findings'])
COMMENTS[82] = [task('Gold stays put', 'Main', '1. Log out and in.',
                     'What should happen: your gold is there.')]
issue(82, 'Gold resets', ['Main Findings'], state='closed', reason='completed',
      closed_at=tick())
COMMENTS[87] = [{'body': 'Test task: Doors open\nServer: Dev\nOpen one.',
                 'created_at': '2026-10-12T01:00:00Z'}]
issue(87, 'Doors stick', ['Dev Findings'], state='closed', reason='completed',
      closed_at=tick())
(tp, te, tr), (dp, de, dr) = both()
th81 = [th for th in df.threads if th.name == 'Ferry lag on dev']
yes('an OPEN issue whose last "Test task:" says Server: Dev is a post in '
    '#dev-test-tasks at once, titled and written from it, tagged Dev, the '
    'Server line not in the body',
    dp == [81] and len(th81) == 1
    and th81[0].content.endswith('1. Ride the ferry.\nWhat should happen: no stutter.')
    and 'Server: Dev' not in th81[0].text()
    and [x.name for x in th81[0].applied_tags] == ['Dev'])
yes('  and nothing in #test-tasks for it while it is open',
    81 not in tp and 'Ferry lag on dev' not in names(tf))
yes('a "Server: Dev" written before #dev-test-tasks began changes nothing: '
    'open, no dev post; closed, its #test-tasks post tagged Main as before',
    80 not in dp and 87 not in dp and 87 in tp
    and [x.name for x in [th for th in tf.threads if th.name == 'Doors open'][0]
         .applied_tags] == ['Main'])
yes('a closed issue whose last test task is Main goes to #test-tasks, tagged '
    'Main, and not to #dev-test-tasks',
    82 in tp and 'Gold stays put' in names(tf) and 82 not in dp)

COMMENTS[82].append(task('Gold on dev after restart', 'Dev', '1. Restart dev.',
                         'What should happen: gold is kept.'))
bump(82)
(tp, te, tr), (dp, de, dr) = both()
yes('a CLOSED issue gets a dev post when its Server: Dev test task was '
    'written after it closed',
    dp == [82] and 'Gold on dev after restart' in names(df))
yes('  and its #test-tasks post stays as it was, not made into the dev task',
    tp == te == tr == [] and 'Gold stays put' in names(tf)
    and 'Gold on dev after restart' not in names(tf))

n, calls = comments_read(), len(g.calls)
out = both()
yes('a second pass reads no comments and changes nothing in either forum',
    comments_read() == n and len(g.calls) == calls
    and out == (([], [], []), ([], [], [])))

dpth = os.path.join(TMP, 'dev-known-issues.json')
bot._known_save(dict(ds, _dirty=True), dpth)
back = bot._state_read(dpth)
count = (len(tf.threads), len(df.threads))
out = both(back)
yes('after a restart, read back from the file, nothing is posted again in '
    'either forum',
    out == (([], [], []), ([], [], []))
    and (len(tf.threads), len(df.threads)) == count)

bot._known_save(dict(ds, _dirty=True), dpth)
snap = bot._state_read(dpth)
COMMENTS[83] = [task('Riften doors on dev', 'Dev', '1. Open a door.')]
issue(83, 'Riften doors', ['Dev Findings'])
saves = []
dp = run(bot.dev_tasks_once(df, ds, gh, save=lambda s: saves.append(1),
                            me_id=me.id))[0]
yes('a new dev post is saved straight after it is made', dp == [83] and saves)
n83 = len(df.threads)
dp = run(bot.dev_tasks_once(df, snap, gh, me_id=me.id))[0]
yes('a dev post that never reached the file is found again by its title, '
    'not doubled',
    len(df.threads) == n83
    and snap['dev']['83']['thread_id'] == ds['dev']['83']['thread_id'])

COMMENTS[81].append(task('Ferry crossing is smooth', 'Main', '1. Ride the ferry.',
                         'What should happen: no stutter.'))
bump(81, state='closed', state_reason='completed', closed_at=tick())
(tp, te, tr), (dp, de, dr) = both()
moved = [th for th in tf.threads if th.name == 'Ferry crossing is smooth']
yes('closed by the main Ship with a newer Main test task: the Main one is '
    'posted in #test-tasks, tagged Main, and the dev post STAYS beside it '
    '(the two are for different people, Patrick 22 Oct)',
    dr == [] and 'Ferry lag on dev' in names(df) and 81 in tp
    and len(moved) == 1 and [x.name for x in moved[0].applied_tags] == ['Main'])

bump(83, state='closed', state_reason='completed', closed_at=tick())
(tp, te, tr), (dp, de, dr) = both()
yes('closed as fixed while its last test task still says Server: Dev: the dev '
    'post STAYS (a check only a dev can do may be up while the fix is on '
    'main, Patrick 22 Oct), and #test-tasks gets nothing from it, not even '
    'the plain line',
    dr == [] and 'Riften doors on dev' in names(df)
    and 83 not in tp and 'Riften doors' not in names(tf))

COMMENTS[89] = [task('Signing in still works', 'Main', '1. Press Play.',
                     'What should happen: you get in.'),
                task('A forged number is refused', 'Dev', '1. Edit the number.',
                     'What should happen: refused, log says so.')]
issue(89, 'Identity', ['Dev Findings'])
(tp, te, tr), (dp, de, dr) = both()
yes('an open issue with a Main test task and a newer Dev one: the Dev one is '
    'in #dev-test-tasks, nothing in #test-tasks while open',
    dp == [89] and 'A forged number is refused' in names(df)
    and 89 not in tp)
bump(89, state='closed', state_reason='completed', closed_at=tick())
(tp, te, tr), (dp, de, dr) = both()
yes('  closed when the fix reaches main: its Main test task goes to '
    '#test-tasks and the Dev one stays in #dev-test-tasks, both at once',
    89 in tp and 'Signing in still works' in names(tf) and dr == []
    and 'A forged number is refused' in names(df))
COMMENTS[89][0]['body'] = 'Taken back: ' + COMMENTS[89][0]['body']
bump(89)
(tp, te, tr), (dp, de, dr) = both()
yes('  a Main test task taken back (its comment no longer starts "Test '
    'task:") takes its #test-tasks post down, and the Dev one stays',
    89 in tr and 'Signing in still works' not in names(tf)
    and 'A forged number is refused' in names(df))

COMMENTS[84] = [task('Smithing on dev', 'Dev', '1. Smith a dagger.')]
issue(84, 'Smithing', ['Dev Findings'])
dp = both()[1][0]
COMMENTS[84].append(task('Smithing works', None, '1. Smith a dagger.'))
bump(84)
(tp, te, tr), (dp2, de, dr) = both()
yes('an open issue given a Main test task beside its Dev one keeps its dev '
    'post, and is not in #test-tasks while open',
    dp == [84] and dr == [] and 'Smithing on dev' in names(df)
    and 84 not in tp and 'Smithing works' not in names(tf))
COMMENTS[84][0]['body'] = 'Withdrawn test task: ' + COMMENTS[84][0]['body']
bump(84)
(tp, te, tr), (dp2, de, dr) = both()
yes('  its Dev comment taken back (first line no longer "Test task:") takes '
    'the dev post down',
    dr == [84] and 'Smithing on dev' not in names(df) and 84 not in tp)

COMMENTS[85] = [task('Forge timing', 'Dev', 'Use a forge.')]
issue(85, 'Forge', ['Dev Findings'])
both()
th85 = [th for th in df.threads if th.name == 'Forge timing'][0]
COMMENTS[85].append(task('Forge timing in Whiterun', 'Dev', 'Use the Whiterun forge.'))
bump(85)
(tp, te, tr), (dp, de, dr) = both()
yes('a rewritten dev test task EDITS its post: the same thread, new title and body',
    de == [85] and dp == [] and th85.name == 'Forge timing in Whiterun'
    and th85.content.endswith('\n\nUse the Whiterun forge.')
    and 'Use a forge.' not in th85.text() and th85 in df.threads)

real_create = df.create_thread
refusals = [1]


async def refuse_once(**k):
    if refusals:
        refusals.pop()
        raise Refused('Missing Permissions')
    return await real_create(**k)


df.create_thread = refuse_once
COMMENTS[86] = [task('Hold panel on dev', 'Dev', 'Pick a hold.')]
issue(86, 'Hold panel', ['Dev Findings'])
issue(88, 'Changed later in the same pass', ['area: Launcher'])
dp = run(bot.dev_tasks_once(df, ds, gh, me_id=me.id))[0]
dp2 = run(bot.dev_tasks_once(df, ds, gh, me_id=me.id))[0]
del df.create_thread
yes('a post Discord refused is tried again on the next pass, though an issue '
    'changed after it was read in that pass, and made once',
    dp == [] and dp2 == [86]
    and names(df).count('Hold panel on dev') == 1)

run(th85.delete())
COMMENTS[85].append(task('Forge timing, last', 'Dev', 'Use any forge.'))
bump(85)
dp = both()[1][0]
yes('a dev post deleted by hand is made again when its test task is rewritten',
    dp == [85] and 'Forge timing, last' in names(df))

bump(81, state='open', state_reason=None, closed_at=None)
(tp, te, tr), (dp, de, dr) = both()
yes('a reopened issue loses its #test-tasks post, as before, and its dev '
    'post stays as it was',
    81 in tr and 'Ferry crossing is smooth' not in names(tf) and 81 not in dp
    and 'Ferry lag on dev' in names(df))
COMMENTS[81].append(task('Ferry lag again on dev', 'Dev', '1. Ride the ferry.'))
bump(81)
dp, de = both()[1][:2]
yes('  and a new Server: Dev test task on it edits that dev post, not a second',
    dp == [] and de == [81] and 'Ferry lag again on dev' in names(df)
    and 'Ferry lag on dev' not in names(df))

hd, said = run(bot.post_test_task(g, 'Measure on dev', 'x', 'Dev',
                                  path=os.path.join(TMP, 'devpass.json')))
th, said2 = run(bot.post_test_task(g, 'By hand', 'Do it on main.'))
out = both()
yes('a hand post tagged Dev lands in #dev-test-tasks and one tagged Main in '
    '#test-tasks, and the passes from the board leave both alone',
    hd in df.threads and [x.name for x in hd.applied_tags] == ['Dev']
    and 'Measure on dev' not in names(tf)
    and th in tf.threads and [x.name for x in th.applied_tags] == ['Main']
    and out == (([], [], []), ([], [], [])))

# ------------ 11. two shapes: #dev-test-tasks for developers, #test-tasks plain --
# Patrick, 12 Oct: the dev one is for developers with GitHub, so it links the
# issue, its pull requests and commits, and gives the whole task, in developer
# terms if it was written that way; the regular test tasks stay without any
# of that, because testers are not developers and have no GitHub.
ISSUES.clear()
COMMENTS.clear()
HOUR[0] = '2026-10-14T08'
UPD[0] = 0
g, tasks, results, play, staff = server()
run(bot.channel_setup(g, apply=True, path=os.path.join(TMP, 'shapes.json')))
tf = bot._channel_named(g, 'test-tasks', ('forum',))
df = bot._channel_named(g, 'dev-test-tasks', ('forum',))
ds = {}
run(bot.test_tasks_once(tf, ds, gh, me_id=me.id, now='2026-10-14T07:59:00Z'))
run(bot.dev_tasks_once(df, ds, gh, me_id=me.id, now='2026-10-14T07:59:30Z'))
REPO_URL = 'https://github.com/ThornswoodRP/Thornswood'
SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'


def pr_ref(num, title, state='closed', merged='2026-10-14T07:00:00Z',
           repo='ThornswoodRP/Thornswood'):
    return {'event': 'cross-referenced', 'source': {'type': 'issue', 'issue': {
        'number': num, 'title': title, 'state': state,
        'html_url': 'https://github.com/%s/pull/%d' % (repo, num),
        'pull_request': {'merged_at': merged},
        'repository': {'full_name': repo}}}}


timeline = [
    pr_ref(900, 'Ferry keeps its speed'),
    pr_ref(901, 'Ferry log line', state='open', merged=None),
    pr_ref(902, 'Abandoned try', merged=None),
    pr_ref(903, 'Somebody else', repo='someone/else'),
    {'event': 'cross-referenced', 'source': {'type': 'issue', 'issue': {
        'number': 904, 'title': 'An issue, not a PR', 'state': 'open',
        'html_url': REPO_URL + '/issues/904'}}},
    {'event': 'referenced', 'commit_id': SHA,
     'commit_url': 'https://api.github.com/repos/ThornswoodRP/Thornswood/commits/' + SHA},
    {'event': 'referenced', 'commit_id': 'f' * 40,
     'commit_url': 'https://api.github.com/repos/someone/else/commits/' + 'f' * 40},
    {'event': 'labeled', 'label': {'name': 'Dev Findings'}},
]
STEPS = ['%d. Run `Get-Content C:\\Thornswood\\Profile\\launcher.log -Tail 40` and '
         'check the line "ferry speed=%d" is there after the crossing.' % (n, n)
         for n in range(1, 41)]
LONG = '\n'.join(STEPS + ['What should happen: every speed line is there, in order.'])
TIMELINE[90] = timeline
COMMENTS[90] = [{'body': 'Test task: Ferry speed in the log\nServer: Dev\n'
                         'Build: gamemode 9fd1f69b on dev\n' + LONG,
                 'created_at': tick(),
                 'html_url': REPO_URL + '/issues/90#issuecomment-1'}]
issue(90, 'Ferry slows down mid crossing', ['Dev Findings', 'area: Gamemode'])
TIMELINE[91] = timeline
COMMENTS[91] = [{'body': 'Test task: Ferry crossing is smooth\nServer: Main\n'
                         '1. Ride the ferry from Windhelm.\n'
                         'What should happen: it keeps the same speed.',
                 'created_at': tick(), 'html_url': REPO_URL + '/issues/91#issuecomment-2'}]
issue(91, 'Ferry stutters', ['Main Findings'], state='closed', reason='completed',
      closed_at=tick())
(tp, te, tr), (dp, de, dr) = both()
d90 = [th for th in df.threads if th.name == 'Ferry speed in the log']
m91 = [th for th in tf.threads if th.name == 'Ferry crossing is smooth']
yes('a dev post links the issue, says its state and labels, and links the test '
    'task comment',
    dp == [90] and len(d90) == 1
    and '**Issue:** #90 Ferry slows down mid crossing <%s/issues/90>' % REPO_URL
    in d90[0].content
    and '**State:** open' in d90[0].content
    and '**Labels:** Dev Findings, area: Gamemode' in d90[0].content
    and '<%s/issues/90#issuecomment-1>' % REPO_URL in d90[0].content)
yes('  links the pull requests that carry the fix, merged or still open, and '
    'not one closed without merging, from another repository, or an issue',
    '- #900 Ferry keeps its speed, merged 2026-10-14T07:00:00Z <%s/pull/900>'
    % REPO_URL in d90[0].content
    and '- #901 Ferry log line, not merged yet <%s/pull/901>' % REPO_URL
    in d90[0].content
    and '#902' not in d90[0].text() and '#903' not in d90[0].text()
    and '#904' not in d90[0].text())
yes('  links the commits of this repository that name the issue, not another\'s',
    '- `%s` <%s/commit/%s>' % (SHA[:10], REPO_URL, SHA) in d90[0].content
    and 'f' * 40 not in d90[0].text())
yes('  and names the build it needs, from the "Build:" line',
    '**Build:** gamemode 9fd1f69b on dev' in d90[0].content)
pos = [d90[0].text().find(step) for step in STEPS]
yes('  the WHOLE test task, in developer terms, never cut: it runs on in the '
    'thread after the first post, every step there once and in order',
    len(LONG) > 2000 and len(d90[0].more) >= 1
    and all(p >= 0 for p in pos) and pos == sorted(pos)
    and all(d90[0].text().count(step) == 1 for step in STEPS)
    and 'What should happen: every speed line is there' in d90[0].text()
    and 'Server: Dev' not in d90[0].text())
yes('  every message within the 2000 characters Discord takes',
    len(d90[0].content) <= 2000 and all(len(m.content) <= 2000 for m in d90[0].more))
yes('a #test-tasks post stays plain: the test task alone, no link, no number, '
    'no label, no pull request, no commit',
    91 in tp and len(m91) == 1
    and m91[0].content == '1. Ride the ferry from Windhelm.\n'
                          'What should happen: it keeps the same speed.'
    and m91[0].more == []
    and not any(x in m91[0].content for x in ('http', '#9', '**', 'Labels', SHA[:10])))

COMMENTS[93] = [{'body': 'Test task: Long one for testers\nServer: Main\n' + LONG,
                 'created_at': tick()}]
issue(93, 'Long for testers', ['Main Findings'], state='closed', reason='completed',
      closed_at=tick())
# With the rules on, as the bot runs: a Main body longer than one message
# is refused and the issue told, never cut at 2000 characters mid-sentence
# (Patrick, 12 Nov).
said93 = []
bot.POST_RULES = True
try:
    tp = run(bot.test_tasks_once(tf, ds, gh, me_id=me.id,
                                 say=lambda n, t: said93.append((n, t))))[0]
finally:
    bot.POST_RULES = False
m93 = [th for th in tf.threads if th.name == 'Long one for testers']
yes('  and a long one for testers is not posted cut: it is refused, and the '
    'issue is told the post holds 2000 characters',
    93 not in tp and m93 == []
    and [n for n, _t in said93] == [93] and 'Format: the text is' in said93[0][1])

th90 = d90[0]
COMMENTS[90].append({'body': 'Test task: Ferry speed, short\nServer: Dev\n'
                             '1. Cross once.\nWhat should happen: one speed line.',
                     'created_at': tick()})
bump(90)
de = both()[1][1]
yes('a dev post rewritten shorter EDITS the same thread and deletes the '
    'follow-ups it no longer needs',
    de == [90] and th90 in df.threads and th90.name == 'Ferry speed, short'
    and th90.more == [] and th90.content.endswith('What should happen: one speed line.')
    and ds['dev']['90']['more'] == [])
COMMENTS[90].append({'body': 'Test task: Ferry speed in the log\nServer: Dev\n' + LONG,
                     'created_at': tick()})
bump(90)
de = both()[1][1]
pos = [th90.text().find(step) for step in STEPS]
yes('  rewritten long again, the follow-ups are sent again, in order, and recorded',
    de == [90] and len(th90.more) >= 1 and all(p >= 0 for p in pos)
    and pos == sorted(pos)
    and ds['dev']['90']['more'] == [m.id for m in th90.more])

run(th90.more[0].delete())
COMMENTS[90].append({'body': 'Test task: Ferry speed in the log\nServer: Dev\n'
                             + LONG + '\nAlso: one more line at the end.',
                     'created_at': tick()})
bump(90)
both()
pos = [th90.text().find(step) for step in STEPS]
yes('a follow-up deleted by hand is sent again and the thread still reads in '
    'order, nothing twice',
    all(p >= 0 for p in pos) and pos == sorted(pos)
    and all(th90.text().count(step) == 1 for step in STEPS)
    and th90.text().endswith('Also: one more line at the end.')
    and ds['dev']['90']['more'] == [m.id for m in th90.more])

dpth = os.path.join(TMP, 'shapes-known.json')
bot._known_save(dict(ds, _dirty=True), dpth)
snap = bot._state_read(dpth)
TIMELINE[92] = []
COMMENTS[92] = [{'body': 'Test task: Long and crashed\nServer: Dev\n' + LONG,
                 'created_at': tick()}]
issue(92, 'Crash between post and save', ['Dev Findings'])
run(bot.dev_tasks_once(df, ds, gh, me_id=me.id))
th92 = [th for th in df.threads if th.name == 'Long and crashed'][0]
n_more = len(th92.more)
run(bot.dev_tasks_once(df, snap, gh, me_id=me.id))
yes('a long dev post that never reached the file is taken up again by its '
    'title: no second thread and no follow-up sent twice',
    len([th for th in df.threads if th.name == 'Long and crashed']) == 1
    and len(th92.more) == n_more and n_more >= 1
    and snap['dev']['92']['more'] == [m.id for m in th92.more]
    and snap['dev']['92']['thread_id'] == th92.id)

# #5197: a post whose issue GitHub deleted comes down. A deleted issue is in
# no list GitHub gives, so only a read of the issue itself finds it gone.
# On 12 Nov six #dev-test-tasks posts still stood for issues deleted weeks
# before.
ISSUES.pop(92, None)
DELETED.add(92)
ds['dev_swept'] = HOUR[0] + ':59:59Z'
asked_before = len(ASKED)
run(bot.dev_tasks_once(df, ds, gh, me_id=me.id, now=HOUR[0] + ':59:59Z'))
yes('within the hour after the last look, the dev pass asks nothing about '
    'posts it did not read',
    '92' in ds['dev'] and not [u for u in ASKED[asked_before:]
                               if u.split('?')[0].endswith('/issues/92')])
ds['dev_swept'] = '2026-10-01T00:00:00Z'
_p, _e, gone = run(bot.dev_tasks_once(df, ds, gh, me_id=me.id))
yes('an hour on, a dev post whose issue was deleted is taken down and '
    'forgotten',
    gone == [92] and '92' not in ds['dev']
    and 'Long and crashed' not in [th.name for th in df.threads])
yes('and the posts whose issues are still there stay',
    len(ds['dev']) > 0 and all(int(k) not in DELETED for k in ds['dev']))
DELETED.discard(92)

COMMENTS[93] = [{'body': 'Test task: Ride the deleted ferry\nServer: Main\n'
                 '1. Board it.\nWhat should happen: you arrive.',
                 'created_at': tick()}]
TIMELINE[93] = []
issue(93, 'A fix whose issue goes', ['Main Findings'], state='closed',
      reason='completed', closed_at=tick())
_fm = bot.fix_in_main
bot.fix_in_main = lambda *a, **k: True
bot.bot_forums.fix_in_main = bot.fix_in_main
run(bot.test_tasks_once(tf, ds, gh, me_id=me.id))
up = '93' in ds.get('tasks', {})
ISSUES.pop(93, None)
DELETED.add(93)
_p, _e, gone = run(bot.test_tasks_once(tf, ds, gh, me_id=me.id))
bot.fix_in_main = _fm
bot.bot_forums.fix_in_main = _fm
yes('a #test-tasks post whose issue was deleted is taken down and forgotten',
    up and gone == [93] and '93' not in ds['tasks']
    and 'Ride the deleted ferry' not in [th.name for th in tf.threads])
DELETED.discard(93)

# #5197: "Checked: passed", newer than the test task, takes its post down;
# "Checked: failed" leaves it, and so does a check older than the test task.
COMMENTS[94] = [{'body': 'Test task: Light the beacon\nServer: Dev\n'
                 '1. Run the beacon command.\nWhat should happen: it lights.',
                 'created_at': tick()}]
TIMELINE[94] = []
issue(94, 'A dev check the run makes', ['Dev Findings'])
run(bot.dev_tasks_once(df, ds, gh, me_id=me.id))
up94 = '94' in ds['dev']
COMMENTS[94].append({'body': 'Checked: failed. The beacon stayed dark.', 'created_at': tick()})
bump(94)
run(bot.dev_tasks_once(df, ds, gh, me_id=me.id))
kept94 = '94' in ds['dev']
COMMENTS[94].append({'body': 'Checked: passed on dev build-1.3.51 by the real game run.\n\n'
                     '---\n_Generated by [Claude Code](https://claude.ai/code)_',
                     'created_at': tick()})
bump(94)
_p, _e, gone = run(bot.dev_tasks_once(df, ds, gh, me_id=me.id))
yes('a dev post stays on "Checked: failed" and comes down on a newer '
    '"Checked: passed"',
    up94 and kept94 and gone == [94] and '94' not in ds['dev']
    and 'Light the beacon' not in [th.name for th in df.threads])
COMMENTS[94].append({'body': 'Test task: Light the beacon twice\nServer: Dev\n'
                     '1. Run it twice.\nWhat should happen: it lights twice.',
                     'created_at': tick()})
bump(94)
run(bot.dev_tasks_once(df, ds, gh, me_id=me.id))
yes('a newer test task after the check is posted again',
    '94' in ds['dev'] and 'Light the beacon twice' in [th.name for th in df.threads])

COMMENTS[95] = [{'body': 'Test task: Ring the bell\nServer: Main\n'
                 '1. Ring it.\nWhat should happen: it rings.',
                 'created_at': tick()}]
TIMELINE[95] = []
issue(95, 'A main check the run makes', ['Main Findings'], state='closed',
      reason='completed', closed_at=tick())
_fm = bot.fix_in_main
bot.fix_in_main = lambda *a, **k: True
bot.bot_forums.fix_in_main = bot.fix_in_main
run(bot.test_tasks_once(tf, ds, gh, me_id=me.id))
up95 = '95' in ds.get('tasks', {})
COMMENTS[95].append({'body': 'Checked: passed on main by the real game run.', 'created_at': tick()})
bump(95)
_p, _e, gone = run(bot.test_tasks_once(tf, ds, gh, me_id=me.id))
bot.fix_in_main = _fm
bot.bot_forums.fix_in_main = _fm
yes('a #test-tasks post comes down on a newer "Checked: passed", and the '
    'bot\'s own line for the fixed finding does not go up in its place',
    up95 and gone == [95] and '95' not in ds['tasks']
    and 'Ring the bell' not in [th.name for th in tf.threads]
    and 'A main check the run makes' not in [th.name for th in tf.threads])

one_line = 'x' * 4500
parts = bot.dev_chunks(one_line)
yes('a line longer than one message is cut where it has to be, nothing lost',
    ''.join(parts) == one_line and all(len(p) <= 2000 for p in parts))


import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location(
    'build_discord', os.path.join(HERE, 'Apply-Discord.py'))
B = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(B)
_plan = [s for _c, specs in B.PLAN for s in specs if s['name'] == 'dev-test-tasks']
# In the Dev space since #3317 (Patrick, 22 Oct: "the tasks and finings under
# staff will go under the new dev category"), moved there by its was line so
# the id the bot finds it by stays the same.
yes('Apply-Discord.py names #dev-test-tasks in Dev, moved from Staff, never makes it '
    '(the bot\'s setup does), never deletes it, and writes the bot\'s own topic on it',
    [c for c, specs in B.PLAN if any(s['name'] == 'dev-test-tasks' for s in specs)]
    == ['Dev'] and ('Staff', 'dev-test-tasks') in (_plan[0].get('was') or ())
    and len(_plan) == 1 and _plan[0].get('make') is False
    and _plan[0]['kind'] == 'forum' and 'dev-test-tasks' in B.KEEP
    and _plan[0].get('topic') == bot.DEV_TOPIC)

# ------- 12. #known-issues holds the findings whose fix has not landed ------
# Patrick, 22 Oct, and #3140: a known issue is a finding people still meet.
# A "Test task:" comment, done-on-merge.yml's comment on a merged fix, or the
# board's Done label for the minute it is on, takes it off. A merged pull request alone does not:
# #503 (scripts never fire) was kept off by a measuring step, and #1626 by a
# Refs written by mistake, while people still met both.
ISSUES.clear()
COMMENTS.clear()
TIMELINE.clear()
g, tasks, results, play, staff = server()
run(bot.channel_setup(g, apply=True, path=os.path.join(TMP, 'known2.json')))
kf = bot._channel_named(g, 'known-issues', ('forum',))
ks = {}
issue(120, 'Chairs stand you up', ['Dev Findings'])
issue(121, 'Killmoves unseen', ['Main Findings'])
issue(122, 'Ferry lag', ['Dev Findings'])
issue(123, 'Scripts never fire', ['Main Findings'])
TIMELINE[121] = [pr_ref(500, 'Work on killmoves', state='open', merged=None)]
TIMELINE[123] = [pr_ref(501, 'The event list is one record (Refs #123)')]
asked_before = len(ASKED)
posted = run(bot.known_issues_once(kf, ks, gh, me_id=me.id))[0]
yes('findings with no test task and not on the board as Done are posts, '
    'whatever pull requests are open or merged for them',
    posted == [120, 121, 122, 123] and sorted(names(kf)) == [
        'Chairs stand you up', 'Ferry lag', 'Killmoves unseen', 'Scripts never fire'])
yes('  and no timeline is read for them',
    not [u for u in ASKED[asked_before:] if '/timeline' in u])
COMMENTS[122] = [task('Ferry is smooth', 'Main', '1. Ride the ferry.')]
bump(122)
# Since #5185 no board: Done label goes on (the card follows the merge by
# itself), so a stray one left from before is just a label, and keeps its post.
bump(121, labels=[{'name': 'Main Findings'}, {'name': 'board: Done'}])
posted, edited, removed = run(bot.known_issues_once(kf, ks, gh, me_id=me.id))
yes('a "Test task:" comment takes its post down; a leftover board: Done '
    'label does not',
    sorted(removed) == [122]
    and sorted(names(kf)) == ['Chairs stand you up', 'Killmoves unseen', 'Scripts never fire'])
out = run(bot.known_issues_once(kf, ks, gh, me_id=me.id))
yes('  nothing comes back on the next pass', out == ([], [], [])
    and sorted(names(kf)) == ['Chairs stand you up', 'Killmoves unseen', 'Scripts never fire'])
bump(121, state='closed', state_reason='completed', closed_at=tick())
removed = run(bot.known_issues_once(kf, ks, gh, me_id=me.id))[2]
yes('  it goes when it closes', removed == [121]
    and sorted(names(kf)) == ['Chairs stand you up', 'Scripts never fire'])
# 26 Oct: board-status.yml took board: Done off within a minute, so #613 and
# #1626 were in Done and still posted. done-on-merge.yml's comment is the
# mark, its test task inside a code block where "Test task:" is not the first
# line.
issue(124, 'Forge list messy', ['Main Findings'])
issue(125, 'Ladders creak', ['Main Findings'])
run(bot.known_issues_once(kf, ks, gh, me_id=me.id))
DOM = ('Pull request #3302 merged (1d39df361ea3), so this is in Done and stays '
       'open: the merge puts the fix on the main branch.\n\n```\nTest task: '
       'Forge recipes\n1. Open the forge.\n```')
COMMENTS[124] = [{'body': DOM, 'user': {'login': 'github-actions[bot]'},
                  'created_at': tick()}]
COMMENTS[125] = [{'body': DOM, 'user': {'login': 'someone'},
                  'created_at': tick()}]
bump(124)
bump(125)
removed = run(bot.known_issues_once(kf, ks, gh, me_id=me.id))[2]
yes('  done-on-merge\'s comment takes its post down; the same words from a '
    'person do not',
    removed == [124] and 'Ladders creak' in names(kf)
    and 'Forge list messy' not in names(kf))
bump(125, state='closed', state_reason='completed', closed_at=tick())
run(bot.known_issues_once(kf, ks, gh, me_id=me.id))
ks['known_changed'] = {'123': 2, '120': True}
del ks['issues']['123']
out = run(bot.known_issues_once(kf, ks, gh, me_id=me.id))
yes('  a finding the old merged-pull-request rule took down is posted again, '
    'and that rule\'s record is gone',
    out[0] == [123] and 'known_changed' not in ks)
bump(120, state='closed', state_reason='completed', closed_at=tick())
removed = run(bot.known_issues_once(kf, ks, gh, me_id=me.id))[2]
yes('  a closed finding goes, as before', removed == [120]
    and names(kf) == ['Scripts never fire'])


# --- 12b. a label list that leaves an issue out does not take its post down --
# #3438: on 22 Oct GitHub's list of open Dev Findings, then of Main Findings,
# then both, came back without issues that were open and labelled the whole
# time, and the same ten posts came down and went back up as a set three
# times. A post comes down on what the issue itself says.
ISSUES.clear()
COMMENTS.clear()
TIMELINE.clear()
g, tasks, results, play, staff = server()
run(bot.channel_setup(g, apply=True, path=os.path.join(TMP, 'known3.json')))
kf = bot._channel_named(g, 'known-issues', ('forum',))
ks = {}
issue(2299, 'Pauses on load', ['Dev Findings'])
issue(2710, 'Doors stick', ['Main Findings'])
issue(385, 'Both servers', ['Dev Findings', 'Main Findings'])
posted = run(bot.known_issues_once(kf, ks, gh, me_id=me.id))[0]
first = sorted(th.id for th in kf.threads)
yes('three findings, three posts', posted == [385, 2299, 2710] and len(first) == 3)
said = []
bot_log = bot.log
bot.log = lambda *a: said.append(' '.join(str(x) for x in a))
try:
    EMPTY_LISTS.update(['Dev Findings'])
    out = run(bot.known_issues_once(kf, ks, gh, me_id=me.id))
    yes('the Dev Findings list comes back empty: nothing is taken down or '
        'posted, the Dev only finding keeps its post (%s)' % (out,),
        out == ([], [], []) and sorted(th.id for th in kf.threads) == first)
    yes('  and the bot log says the list left it out and the post stays',
        any('left out #2299' in x and 'post stays' in x for x in said))
    EMPTY_LISTS.update(['Main Findings'])
    out = run(bot.known_issues_once(kf, ks, gh, me_id=me.id))
    yes('both lists come back empty: still nothing comes down (%s)' % (out,),
        out == ([], [], []) and sorted(th.id for th in kf.threads) == first
        and sorted(ks['issues']) == ['2299', '2710', '385'])
    EMPTY_LISTS.clear()
    out = run(bot.known_issues_once(kf, ks, gh, me_id=me.id))
    yes('the lists answer again: nothing is posted twice',
        out == ([], [], []) and sorted(th.id for th in kf.threads) == first)
    EMPTY_LISTS.update(['Dev Findings', 'Main Findings'])
    bump(2299, state='closed', state_reason='completed', closed_at=tick())
    bump(2710, labels=[{'name': 'bug'}])
    DELETED.add(385)
    del said[:]
    removed = sorted(run(bot.known_issues_once(kf, ks, gh, me_id=me.id))[2])
    yes('a left out issue that is closed, unlabelled or deleted does come down',
        removed == [385, 2299, 2710] and kf.threads == [] and ks['issues'] == {})
    yes('  each with its reason in the bot log',
        any('took #2299 down: it is closed' in x for x in said)
        and any('took #2710 down: it no longer carries' in x for x in said)
        and any('took #385 down: GitHub has no issue #385' in x for x in said))
    EMPTY_LISTS.clear()
    DELETED.clear()
    issue(2299, 'Pauses on load', ['Dev Findings'])
    issue(2215, 'Moved away', ['Dev Findings'])
    run(bot.known_issues_once(kf, ks, gh, me_id=me.id))
    EMPTY_LISTS.update(['Dev Findings'])
    ISSUES[2215]['repository_url'] = 'https://api.github.com/repos/ThornswoodRP/skymp'
    del said[:]
    removed = run(bot.known_issues_once(kf, ks, gh, me_id=me.id))[2]
    yes('  and so does one moved to another repository',
        removed == [2215] and any('took #2215 down: it moved to thornswoodrp/skymp'
                                  in x for x in said))
    # The repository itself moved to another owner (#5184): GitHub answers
    # its issues under the new name, and they are still the bot's. Here the
    # bot still has the name from before the move, as a bot.env.json that
    # sets KNOWN_ISSUES_REPO would give it.
    known_repo = bot.KNOWN_REPO
    bot.KNOWN_REPO = REPO_NOW[0] = 'EvilPatrick06/Thornswood'
    EMPTY_LISTS.discard('Dev Findings')
    issue(2216, 'Still here', ['Dev Findings'])
    ISSUES[2216]['repository_url'] = 'https://api.github.com/repos/EvilPatrick06/Thornswood'
    posted = run(bot.known_issues_once(kf, ks, gh, me_id=me.id))[0]
    yes('  (a finding in the repository is posted)', 2216 in posted)
    EMPTY_LISTS.update(['Dev Findings'])
    REPO_NOW[0] = 'ThornswoodRP/Thornswood'
    ISSUES[2216]['repository_url'] = 'https://api.github.com/repos/ThornswoodRP/Thornswood'
    del said[:]
    removed = run(bot.known_issues_once(kf, ks, gh, me_id=me.id))[2]
    yes('  but one whose repository moved to another owner stays up (#5184)',
        2216 not in removed and not any('took #2216 down' in x for x in said))
    # and its writes go to the new name, since GitHub answers a POST to the
    # old one with a 307 that urllib does not follow (#5184).
    wrote = []

    class _Answer:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"number": 7}'

    real_open = bot.urllib.request.urlopen
    bot.urllib.request.urlopen = lambda req, timeout=None: (wrote.append(req.full_url), _Answer())[1]
    token = os.environ.get('GITHUB_TOKEN')
    os.environ['GITHUB_TOKEN'] = 'stand-in'
    try:
        bot.github_say(2216, 'x')
        bot.github_file('t', 'b', [])
    finally:
        bot.urllib.request.urlopen = real_open
        if token is None:
            os.environ.pop('GITHUB_TOKEN', None)
        else:
            os.environ['GITHUB_TOKEN'] = token
    yes('  and its comments and new issues go to the name it has now',
        wrote == [bot.GITHUB_API + '/repos/ThornswoodRP/Thornswood/issues/2216/comments',
                  bot.GITHUB_API + '/repos/ThornswoodRP/Thornswood/issues'])
    # The App's token from the box admin service (#5184, Patrick's A of 1 Nov).
    tf = os.path.join(TMP, 'github-token.json')
    t0 = 1793502400  # 2026-11-01T03:06:40Z
    os.environ['GITHUB_TOKEN'] = 'github_pat_old'
    try:
        yes('no token file: the bot uses GITHUB_TOKEN',
            bot.github_token(tf, t0) == 'github_pat_old' and bot._token_from_file(tf, t0)[1].endswith('is not there'))
        with open(tf, 'w', encoding='utf-8') as f:
            json.dump({'token': 'ghs_app', 'expires_at': '2026-11-01T04:06:40Z'}, f)
        del said[:]
        yes('  a token the App made, with an hour left, is the one used',
            bot.github_token(tf, t0) == 'ghs_app' and bot.github_token_kind('ghs_app') == 'app installation')
        yes('  and the log says which, once, never the token',
            [x for x in said if 'github:' in x] == ["github: the App's token from " + tf] and not any('ghs_app' in x for x in said))
        bot.github_token(tf, t0)
        yes('  (said once while it stays the same)', len([x for x in said if 'github:' in x]) == 1)
        yes('  one with under two minutes left is not used',
            bot.github_token(tf, t0 + 3600 - 60) == 'github_pat_old' and 'ended at 2026-11-01T04:06:40Z' in bot._token_from_file(tf, t0 + 3540)[1])
        with open(tf, 'w', encoding='utf-8') as f:
            f.write('{half')
        yes('  a file that will not read is not used, and why names no token',
            bot.github_token(tf, t0) == 'github_pat_old' and 'will not read' in bot._token_from_file(tf, t0)[1])
        os.environ['GITHUB_TOKEN'] = ''
        yes('  with neither there is no token', bot.github_token(tf, t0) == '')
    finally:
        if token is None:
            os.environ.pop('GITHUB_TOKEN', None)
        else:
            os.environ['GITHUB_TOKEN'] = token
        bot._TOKEN_SAID['line'] = ''
    yes('  and the bot can say which kind of token it has, never the token',
        [bot.github_token_kind(t) for t in
         ('github_pat_x', 'ghp_x', 'ghs_x', 'gho_x', '', 'zzz')] ==
        ['fine-grained', 'classic', 'app installation', 'oauth', 'no', 'unknown'])
    bot.KNOWN_REPO = REPO_NOW[0] = known_repo
    bot._KNOWN_REPO_NOW['name'] = ''
    ISSUES[2216].update(state='closed',
                        repository_url='https://api.github.com/repos/' + known_repo)

    def broken_issue(url):
        if '/issues/2299' in url.split('?')[0]:
            raise bot.urllib.error.HTTPError(url, 502, 'Bad Gateway', {}, None)
        return gh(url)
    ISSUES[2215]['repository_url'] = 'https://api.github.com/repos/ThornswoodRP/Thornswood'
    run(bot.known_issues_once(kf, ks, gh, me_id=me.id))
    EMPTY_LISTS.update(['Dev Findings'])
    keep = sorted(th.id for th in kf.threads)
    try:
        run(bot.known_issues_once(kf, ks, broken_issue, me_id=me.id))
        failed = False
    except bot.urllib.error.HTTPError:
        failed = True
    yes('a left out issue that will not read fails the pass, and every post '
        'is still up', failed and sorted(th.id for th in kf.threads) == keep
        and len(keep) == 2)
finally:
    bot.log = bot_log
    EMPTY_LISTS.clear()
    DELETED.clear()


# ------------- 13. never two posts for one thing, and the check that finds them --
# Patrick, 22 Oct: duplicates in all three forums. A post whose record was
# lost was made again when its first one had been closed, because only open
# posts were looked at.
ISSUES.clear()
COMMENTS.clear()
TIMELINE.clear()
g, tasks, results, play, staff = server()
run(bot.channel_setup(g, apply=True, path=os.path.join(TMP, 'dupes.json')))
tf = bot._channel_named(g, 'test-tasks', ('forum',))
ts = {}
run(bot.test_tasks_once(tf, ts, gh, me_id=me.id, now='2026-10-14T00:00:00Z'))
COMMENTS[130] = [task('Boards stand in town', 'Main', '1. Look.')]
issue(130, 'Boards', ['area: x'], state='closed', reason='completed', closed_at=tick())
run(bot.test_tasks_once(tf, ts, gh, me_id=me.id))
first = [th for th in tf.threads if th.name == 'Boards stand in town']
first[0].archived = True
ts['tasks'].clear()
bump(130)
run(bot.test_tasks_once(tf, ts, gh, me_id=me.id))
yes('a post staff closed is found again by its title when its record is lost, '
    'not made a second time',
    len(first) == 1 and names(tf).count('Boards stand in town') == 1
    and ts['tasks']['130']['thread_id'] == first[0].id)

dup = run(tf.create_thread(name='Boards stand in town', content='again',
                           applied_tags=[]))
orphan = run(tf.create_thread(name='Hand post', content='x', applied_tags=[]))
COMMENTS[131] = [task('Gates open', 'Main', '1. Walk in.')]
COMMENTS[132] = [task('Gates open', 'Main', '1. Walk in.')]
issue(131, 'Gate A', ['area: x'], state='closed', reason='completed', closed_at=tick())
run(bot.test_tasks_once(tf, ts, gh, me_id=me.id))
gates = [th for th in tf.threads if th.name == 'Gates open']
ts['tasks']['132'] = {'thread_id': run(tf.create_thread(
    name='Gates open', content='y', applied_tags=[])).id}
recs = bot.forum_records(ts)['tasks']
look = run(bot.forum_check(tf, recs, me.id))
yes('the forum check finds two posts under one title, says which it keeps '
    '(the one an issue owns) and changes nothing without --apply',
    any('"Boards stand in town": 2 posts; keeps %d (#130)' % first[0].id in l for l in look)
    and any('would delete %d' % dup.id in l for l in look)
    and dup in tf.threads and orphan in tf.threads)
yes('  two issues owning one title are said, for fixing on the issues, and '
    'neither post is deleted',
    any('two issues own this title' in l for l in look)
    and not any('would delete %d' % gates[0].id in l for l in look))
did = run(bot.forum_check(tf, recs, me.id, apply=True))
yes('  with --apply the extra one is deleted, the owned ones and a lone hand '
    'post stay',
    dup not in tf.threads and first[0] in tf.threads and orphan in tf.threads
    and names(tf).count('Gates open') == 2 and any('1 deleted' in l for l in did))


# ---------------- 5515: a completed task later closed without a fix --
# There is no pass seeing the issue open: both reads see it closed.
def reclosed_task(reason, *, omitted=False, refuse_archive=False,
                  apply_before_refusal=False, unreadable=False, prepare=None):
    ISSUES.clear()
    COMMENTS.clear()
    TIMELINE.clear()
    g, *_ = server()
    run(bot.channel_setup(g, apply=True, path=os.path.join(TMP, 'reclosed-%s.json' % UPD[0])))
    forum = bot._channel_named(g, 'test-tasks', ('forum',))
    state = {'since': '2026-10-01T00:00:00Z'}
    issue(5515, 'A completed fix', [], state='closed', reason='completed',
          closed_at='2026-10-15T00:00:00Z')
    COMMENTS[5515] = [{'body': 'Test task: Try the completed fix\nServer: Main\n1. Try it.\nIt works.'}]
    first = run(bot.test_tasks_once(forum, state, gh, me_id=g.me.id))
    yes('5515: the first pass posts the actual completed task',
        first == ([5515], [], []) and len(forum.threads) == 1)
    # Persist and restart so no live reopen event or memory can remove it.
    path = os.path.join(TMP, 'reclosed-state.json')
    bot._known_save(state, path)
    state = bot._state_read(path)
    thread = forum.threads[0]
    run(thread.send('Test result from a player'))
    if prepare:
        prepare(forum, state, thread)
    issue(5515, 'No longer a completed fix', [], state='closed', reason=reason,
          closed_at='2026-10-16T00:00:00Z')
    state.pop('_dirty', None)
    ASKED[:] = []
    def read(url):
        if omitted and 'state=closed' in url:
            return []  # an adopted post older than the list's since cutoff
        if unreadable and '/issues/5515' in url and '/comments' not in url:
            raise bot.urllib.error.HTTPError(url, 503, 'Unavailable', {}, None)
        return gh(url)
    original_edit = thread.edit
    if refuse_archive:
        async def denied(**kwargs):
            assert bot._state_read(path)['tasks']['5515']['withdrawal'] == 'pending'
            if apply_before_refusal:
                thread.archived = True
            raise discord.Forbidden(type('R', (), {'status': 403, 'reason': 'denied'})(),
                                    'Missing permission to archive the post')
        thread.edit = denied
    result = run(bot.test_tasks_once(
        forum, state, read, me_id=g.me.id, save=lambda s: bot._known_save(s, path)))
    return forum, state, thread, original_edit, result, read, g


for reason, omitted in [('not_planned', False), ('duplicate', False),
                        ('not_planned', True), ('duplicate', True)]:
    forum, state, thread, _, result, read, g = reclosed_task(reason, omitted=omitted)
    yes('5515: %s closed issue is archived through %s with replies and receipt intact'
        % (reason, 'direct read' if omitted else 'closed list'),
        result == ([], [], [5515]) and forum.threads == [thread] and thread.archived
        and thread.more[0].content == 'Test result from a player'
        and state['tasks']['5515']['withdrawal'] == 'archived')
    yes('5515: removal needs no task comment read or repost',
        not any('/comments' in url for url in ASKED))
    calls = len(g.calls)
    yes('5515: another normal pass does not archive or post twice',
        run(bot.test_tasks_once(forum, state, read, me_id=g.me.id)) == ([], [], [])
        and len(g.calls) == calls)

for omitted in [False, True]:
    forum, state, thread, original, result, read, g = reclosed_task(
        'not_planned', omitted=omitted, refuse_archive=True)
    yes('5515: Discord refusal retains the thread and receipt for a later pass',
        result == ([], [], []) and forum.threads == [thread]
        and not thread.archived and state['tasks']['5515']['thread_id'] == thread.id
        and state['tasks']['5515']['withdrawal'] == 'pending')
    thread.edit = original
    yes('5515: the next normal pass retries the refused archive',
        run(bot.test_tasks_once(forum, state, read, me_id=g.me.id)) == ([], [], [5515])
        and forum.threads == [thread] and thread.archived
        and state['tasks']['5515']['withdrawal'] == 'archived')


forum, state, thread, _, result, read, g = reclosed_task(
    'duplicate', refuse_archive=True, apply_before_refusal=True)
path = os.path.join(TMP, 'reclosed-state.json')
state = bot._state_read(path)
yes('5515: a final permission refusal after an applied edit keeps durable intent',
    result == ([], [], []) and thread.archived
    and state['tasks']['5515']['withdrawal'] == 'pending')
yes('5515: a fresh read after restart confirms the archive despite final refusal',
    run(bot.test_tasks_once(forum, state, read, me_id=g.me.id)) == ([], [], [5515])
    and state['tasks']['5515']['withdrawal'] == 'archived')


def uncertain_archive(forum, state, thread):
    async def uncertain(**kwargs):
        thread.archived = True
        return None
    thread.edit = uncertain


forum, state, thread, _, result, read, g = reclosed_task(
    'duplicate', prepare=uncertain_archive)
yes('5515: an uncertain archive result leaves the receipt pending',
    result == ([], [], []) and state['tasks']['5515']['withdrawal'] == 'pending')
yes('5515: a later verified archive settles the pending receipt',
    run(bot.test_tasks_once(forum, state, read, me_id=g.me.id)) == ([], [], [5515])
    and state['tasks']['5515']['withdrawal'] == 'archived')


for reason in ['completed', None]:
    forum, state, thread, _, result, _, _ = reclosed_task(reason)
    yes('5515: completed or legacy absent reason retains its task',
        result == ([], [], []) and forum.threads == [thread]
        and '5515' in state['tasks'])

forum, state, thread, _, result, _, _ = reclosed_task(
    'not_planned', omitted=True, unreadable=True)
yes('5515: a failed direct GitHub read cannot prove the task should be removed',
    result == ([], [], []) and forum.threads == [thread]
    and '5515' in state['tasks'])

def duplicate_receipt(forum, state, thread):
    issue(5516, 'Different issue', [], state='closed', reason='completed')
    state['tasks']['5516'] = dict(state['tasks']['5515'], updated=ISSUES[5516]['updated_at'])


for label, prepare in [
    ('another forum', lambda f, s, t: setattr(t, 'parent_id', f.id + 1)),
    ('another owner', lambda f, s, t: setattr(t, 'owner_id', 22)),
    ('old forum receipt', lambda f, s, t: s['tasks']['5515'].update(channel_id=None)),
    ('different title', lambda f, s, t: setattr(t, 'name', 'Another test')),
    ('another issue receipt', duplicate_receipt),
]:
    forum, state, thread, _, result, _, _ = reclosed_task('not_planned', prepare=prepare)
    yes('5515: %s cannot authorize archiving a Main post' % label,
        result == ([], [], []) and forum.threads == [thread] and not thread.archived
        and 'withdrawal' not in state['tasks']['5515'])

forum, state, thread, _, result, read, g = reclosed_task(
    'not_planned', prepare=lambda f, s, t: setattr(t, 'archived', True))
yes('5515: an already archived post gains no automatic restoration marker',
    result == ([], [], []) and thread.archived and 'withdrawal' not in state['tasks']['5515'])
issue(5515, 'Completed again', [], state='closed', reason='completed',
      closed_at='2026-10-18T00:00:00Z')
run(bot.test_tasks_once(forum, state, read, me_id=g.me.id))
yes('5515: completing the issue does not unarchive a post the bot did not retire',
    thread.archived)

for omitted in [False, True]:
    forum, state, thread, _, _, read, g = reclosed_task('not_planned', omitted=omitted)
    path = os.path.join(TMP, 'reclosed-state.json')
    bot._known_save(state, path)
    state = bot._state_read(path)
    issue(5515, 'Reopened', [], state='open')
    run(bot.test_tasks_once(forum, state, read, me_id=g.me.id))
    yes('5515: observing the issue reopen keeps the archived thread and replies',
        forum.threads == [thread] and thread.archived and len(thread.more) == 1)
    issue(5515, 'Closed without reason', [], state='closed',
          closed_at='2026-10-18T00:00:00Z')
    run(bot.test_tasks_once(forum, state, read, me_id=g.me.id))
    yes('5515: a closure without an explicit completed reason keeps the archive',
        forum.threads == [thread] and thread.archived)
    issue(5515, 'Completed again', [], state='closed', reason='completed',
          closed_at='2026-10-18T00:00:00Z')
    yes('5515: completing the same proven task restores original thread and replies',
        run(bot.test_tasks_once(forum, state, read, me_id=g.me.id)) == ([], [5515], [])
        and forum.threads == [thread] and not thread.archived
        and thread.more[0].content == 'Test result from a player'
        and 'withdrawal' not in state['tasks']['5515'])

for label, change in [
    ('a changed owner', lambda t: setattr(t, 'owner_id', 22)),
    ('a staff lock', lambda t: setattr(t, 'locked', True)),
]:
    forum, state, thread, _, _, read, g = reclosed_task('not_planned')
    change(thread)
    issue(5515, 'Completed again', [], state='closed', reason='completed',
          closed_at='2026-10-18T00:00:00Z')
    yes('5515: %s keeps the retired post in the archive' % label,
        run(bot.test_tasks_once(forum, state, read, me_id=g.me.id)) == ([], [], [])
        and forum.threads == [thread] and thread.archived and len(thread.more) == 1
        and state['tasks']['5515']['withdrawal'] == 'archived')


# A fresh completed fix can need new instructions. Keep the old discussion
# archived, while the canonical new-task path owns a distinct active post.
for omitted in [False, True]:
    for same_title in [False, True]:
        forum, state, thread, _, _, read, g = reclosed_task('not_planned', omitted=omitted)
        original_text, replies = thread.text(), list(thread.more)
        title = thread.name if same_title else 'Try the revised completed fix'
        COMMENTS[5515][0]['body'] = 'Test task: %s\nServer: Main\n1. Try the new fix.\nIt works.' % title
        issue(5515, 'Completed revised fix', [], state='closed', reason='completed',
              closed_at='2026-10-18T00:00:00Z')
        path = os.path.join(TMP, 'reclosed-state.json')
        result = run(bot.test_tasks_once(forum, state, read, me_id=g.me.id,
                       save=lambda value: bot._known_save(value, path)))
        active = [t for t in forum.threads if not t.archived]
        yes('5515: revised completed task creates one new active post, including the same title',
            result == ([5515], [], []) and len(active) == 1 and active[0] is not thread
            and active[0].name == title and active[0].content == '1. Try the new fix.\nIt works.')
        yes('5515: revised task leaves the original archived instructions and replies intact',
            thread.archived and thread.text() == original_text and thread.more == replies)
        yes('5515: the saved current receipt owns the new active task',
            len(active) == 1 and bot._state_read(path)['tasks']['5515']['thread_id'] == active[0].id
            and 'withdrawal' not in state['tasks']['5515'])
        yes('5515: another pass does not create or rewrite another copy of the new task',
            run(bot.test_tasks_once(forum, state, read, me_id=g.me.id)) == ([], [], [])
            and len(forum.threads) == 2 and thread.text() == original_text)

forum, state, thread, original_edit, _, read, g = reclosed_task('not_planned', refuse_archive=True)
thread.edit = original_edit
COMMENTS[5515][0]['body'] = 'Test task: Try revised instructions\nServer: Main\n1. Try the new fix.\nIt works.'
issue(5515, 'Completed revised fix', [], state='closed', reason='completed',
      closed_at='2026-10-18T00:00:00Z')
result = run(bot.test_tasks_once(forum, state, read, me_id=g.me.id))
yes('5515: a pending withdrawal archives original history before posting revised instructions',
    result == ([5515], [], []) and thread.archived and len(thread.more) == 1
    and len([t for t in forum.threads if not t.archived]) == 1)

forum, state, thread, _, _, read, g = reclosed_task('not_planned')
COMMENTS[5515][0]['body'] = 'Test task: Try unvalidated revised instructions\nServer: Main\n1. As staff, use /ban on somebody.\nIt works.'
issue(5515, 'Completed revised fix', [], state='closed', reason='completed',
      closed_at='2026-10-18T00:00:00Z')
refusals = []
bot.POST_RULES = True
try:
    result = run(bot.test_tasks_once(forum, state, read, me_id=g.me.id,
                                    say=lambda number, text: refusals.append((number, text))))
finally:
    bot.POST_RULES = False
yes('5515: revised tasks still require the canonical Main post validation',
    result == ([], [], []) and forum.threads == [thread] and thread.archived
    and refusals and state['tasks']['5515']['withdrawal'] == 'archived')


forum, state, thread, _, _, read, g = reclosed_task('not_planned')
versions = [(thread, thread.text())]
for version in [1, 2]:
    if version == 2:
        issue(5515, 'Withdrawn again', [], state='closed', reason='not_planned',
              closed_at='2026-10-19T00:00:00Z')
        run(bot.test_tasks_once(forum, state, read, me_id=g.me.id))
    COMMENTS[5515][0]['body'] = 'Test task: %s\nServer: Main\n1. Try revision %s.\nIt works.' % (thread.name, version)
    issue(5515, 'Completed revision', [], state='closed', reason='completed',
          closed_at='2026-10-20T00:00:00Z')
    result = run(bot.test_tasks_once(forum, state, read, me_id=g.me.id))
    active = [t for t in forum.threads if not t.archived]
    yes('5515: repeated same-title revisions preserve every earlier archived discussion',
        result == ([5515], [], []) and len(active) == 1
        and len(forum.threads) == version + 1
        and all(t.archived and t.text() == original for t, original in versions))
    if active:
        run(active[0].send('Results for revision %s' % version))
        versions.append((active[0], active[0].text()))


for omitted in [False, True]:
    forum, state, thread, original_edit, _, read, g = reclosed_task('not_planned', omitted=omitted)
    thread.archived = False
    run(thread.send('A follow-up in the retired task'))
    history = thread.text()
    result = run(bot.test_tasks_once(forum, state, read, me_id=g.me.id))
    yes('5515: an active-again withdrawn task is rearchived on the next normal pass',
        result == ([], [], [5515]) and thread.archived and thread.text() == history
        and len(thread.more) == 2)
    thread.archived = False
    thread.owner_id = 22
    result = run(bot.test_tasks_once(forum, state, read, me_id=g.me.id))
    yes('5515: a stale archived marker cannot bypass current owner verification',
        result == ([], [], []) and not thread.archived and thread.text() == history)
    thread.owner_id = g.me.id
    async def denied_again(**kwargs):
        raise Refused('Missing permission to archive again')
    thread.edit = denied_again
    result = run(bot.test_tasks_once(forum, state, read, me_id=g.me.id))
    yes('5515: refused rearchiving keeps pending intent and every follow-up reply',
        result == ([], [], []) and not thread.archived and thread.text() == history
        and state['tasks']['5515']['withdrawal'] == 'pending')
    thread.edit = original_edit
    result = run(bot.test_tasks_once(forum, state, read, me_id=g.me.id))
    yes('5515: normal retry confirms rearchiving after the refusal',
        result == ([], [], [5515]) and thread.archived and thread.text() == history
        and state['tasks']['5515']['withdrawal'] == 'archived')


def denied_save(state):
    raise OSError('Unable to replace the forum index')


forum, state, thread, _, _, read, g = reclosed_task('completed')
issue(5515, 'Withdrawn', [], state='closed', reason='duplicate',
      closed_at='2026-10-18T00:00:00Z')
try:
    run(bot.test_tasks_once(forum, state, read, me_id=g.me.id, save=denied_save))
except OSError:
    yes('5515: failure to persist new archive intent prevents mutation',
        not thread.archived and 'withdrawal' not in state['tasks']['5515'])
else:
    yes('5515: failure to persist new archive intent prevents mutation', False)

forum, state, thread, _, _, read, g = reclosed_task('not_planned')
issue(5515, 'Completed again', [], state='closed', reason='completed',
      closed_at='2026-10-18T00:00:00Z')
try:
    run(bot.test_tasks_once(forum, state, read, me_id=g.me.id, save=denied_save))
except OSError:
    yes('5515: failed restoration save retains the ownership marker for retry',
        not thread.archived and state['tasks']['5515']['withdrawal'] == 'archived')
else:
    yes('5515: failed restoration save retains the ownership marker for retry', False)
calls = len(g.calls)
yes('5515: the next pass persists verified restoration without another edit',
    run(bot.test_tasks_once(forum, state, read, me_id=g.me.id,
                            save=lambda s: bot._known_save(s, path))) == ([], [], [])
    and len(g.calls) == calls and 'withdrawal' not in bot._state_read(path)['tasks']['5515'])


forum, state, thread, _, _, read, g = reclosed_task('not_planned')
COMMENTS[5515][0]['body'] = 'Test task: Try the newly completed fix\nServer: Main\n1. Try the next fix.\nIt works.'
issue(5515, 'Completed revised fix', [], state='closed', reason='completed',
      closed_at='2026-10-18T00:00:00Z')
path = os.path.join(TMP, 'reclosed-state.json')
def deny_receipt_save(value):
    if value['tasks']['5515'].get('revision'):
        bot._known_save(value, path)
    else:
        denied_save(value)
try:
    run(bot.test_tasks_once(forum, state, read, me_id=g.me.id, save=deny_receipt_save))
except OSError:
    yes('5515: replacement accepted before receipt-save failure preserves the old archive',
        thread.archived and len(thread.more) == 1 and len(forum.threads) == 2)
else:
    yes('5515: replacement accepted before receipt-save failure preserves the old archive', False)
path = os.path.join(TMP, 'reclosed-state.json')
state = bot._state_read(path)
result = run(bot.test_tasks_once(forum, state, read, me_id=g.me.id,
                               save=lambda value: bot._known_save(value, path)))
active = [t for t in forum.threads if not t.archived]
yes('5515: restart adopts the already accepted replacement without creating a duplicate',
    result == ([5515], [], []) and len(forum.threads) == 2 and len(active) == 1
    and bot._state_read(path)['tasks']['5515']['thread_id'] == active[0].id
    and thread.archived and len(thread.more) == 1)


forum, state, thread, _, _, read, g = reclosed_task('not_planned')
new_title = 'Try the revised fix'
wrong = run(forum.create_thread(name=new_title, content='Unrelated older task.',
                                 applied_tags=tag(forum, 'Main')))
COMMENTS[5515][0]['body'] = ('Test task: %s\nServer: Main\n1. Try the replacement.\n'
                            'It works.') % new_title
issue(5515, 'Completed revised fix', [], state='closed', reason='completed',
      closed_at='2026-10-18T00:00:00Z')
run(bot.test_tasks_once(forum, state, read, me_id=g.me.id))
yes('5515 external reproduction: a same-title bot post with other instructions cannot be adopted',
    state['tasks']['5515']['thread_id'] != wrong.id and wrong.content == 'Unrelated older task.')


forum, state, thread, _, _, read, g = reclosed_task('not_planned')
COMMENTS[5515][0]['body'] = ('Test task: Try a delayed-cache fix\nServer: Main\n'
                            '1. Try the replacement.\nIt works.')
issue(5515, 'Completed revised fix', [], state='closed', reason='completed',
      closed_at='2026-10-18T00:00:00Z')
create = forum.create_thread
path = os.path.join(TMP, 'reclosed-state.json')
wrong_marker = run(create(name='Try a delayed-cache fix', content='1. Try the replacement.\nIt works.',
                          applied_tags=tag(forum, 'Main'),
                          embed=discord.Embed().set_footer(text='Main test task #5516 · different'))).thread
delayed = []

async def accepted_missing_cache(**kwargs):
    assert bot._state_read(path)['tasks']['5515']['revision']['token'] in kwargs['embed'].footer.text
    created = (await create(**kwargs)).thread
    forum.threads.remove(created)
    delayed.append(created)
    raise discord.Forbidden(type('R', (), {'status': 403, 'reason': 'denied'})(),
                            'Final retry refused after HTTP accepted first send')

forum.create_thread = accepted_missing_cache
run(bot.test_tasks_once(forum, state, read, me_id=g.me.id,
                        save=lambda value: bot._known_save(value, path)))
forum.create_thread = create
state = bot._state_read(path)
revised = delayed[0]
del g.threads[revised.id]
calls = len(g.calls)
yes('5515: an exact-title-and-body post with another issue marker cannot settle the attempt',
    run(bot.test_tasks_once(forum, state, read, me_id=g.me.id)) == ([], [], [])
    and state['tasks']['5515']['thread_id'] == thread.id
    and state['tasks']['5515'].get('revision') and len(g.calls) == calls)
g.threads[revised.id] = revised
rest_active_threads = g.active_threads
async def unavailable_active_threads():
    raise OSError('Discord unavailable')
g.active_threads = unavailable_active_threads
yes('5515: failed Discord REST reads preserve intent without resending',
    run(bot.test_tasks_once(forum, state, read, me_id=g.me.id)) == ([], [], [])
    and state['tasks']['5515'].get('revision') and len(g.calls) == calls)
g.active_threads = rest_active_threads
yes('5515: a lost create response is reconciled through REST without another create',
    run(bot.test_tasks_once(forum, state, read, me_id=g.me.id)) == ([5515], [], [])
    and state['tasks']['5515']['thread_id'] == revised.id
    and revised not in forum.threads and wrong_marker in forum.threads
    and thread.archived and len(g.calls) == calls)


forum, state, thread, _, _, read, g = reclosed_task('not_planned')
COMMENTS[5515][0]['body'] = ('Test task: Try a withdrawn pending revision\nServer: Main\n'
                            '1. Try the replacement.\nIt works.')
issue(5515, 'Completed revised fix', [], state='closed', reason='completed',
      closed_at='2026-10-18T00:00:00Z')
create = forum.create_thread
delayed = []
forum.create_thread = accepted_missing_cache
run(bot.test_tasks_once(forum, state, read, me_id=g.me.id,
                        save=lambda value: bot._known_save(value, path)))
forum.create_thread = create
issue(5515, 'Withdrew the revised fix', [], state='closed', reason='not_planned',
      closed_at='2026-10-19T00:00:00Z')
state = bot._state_read(path)
yes('5515: a subsequent withdrawal reconciles and archives the accepted pending revision',
    run(bot.test_tasks_once(forum, state, read, me_id=g.me.id)) == ([5515], [], [5515])
    and delayed[0].archived and thread.archived and len(thread.more) == 1
    and state['tasks']['5515']['thread_id'] == delayed[0].id)


forum, state, thread, _, _, read, g = reclosed_task('not_planned')
COMMENTS[5515][0]['body'] = 'Test task: Try revised fix\nServer: Main\n1. Try the next fix.\nIt works.'
issue(5515, 'Completed revised fix', [], state='closed', reason='completed',
      closed_at='2026-10-18T00:00:00Z')
try:
    run(bot.test_tasks_once(forum, state, read, me_id=g.me.id, save=denied_save))
except OSError:
    yes('5515: failed revision-intent save prevents create',
        forum.threads == [thread] and thread.archived and not state['tasks']['5515'].get('revision'))
else:
    yes('5515: failed revision-intent save prevents create', False)


wsrc = inspect.getsource(bot.watch_known_issues)
yes('the watcher finds #dev-test-tasks by the id the setup recorded, never by '
    'its name, and keeps it each pass',
    'dev_tasks_forum(g)' in wsrc and 'dev_tasks_once(' in wsrc
    and '_channel_named(g, DEV_TASKS_NAME' not in wsrc)


saved_token = os.environ.pop('GITHUB_TOKEN', None)


class Ready(object):
    closed = False
    async def wait_until_ready(self):
        return None
    def is_closed(self):
        return self.closed


ready_client = Ready()
slept, warned = [], []
class OnePassAsyncio:
    def __getattr__(self, name):
        return getattr(asyncio, name)
    async def sleep(self, seconds):
        slept.append(seconds)
        ready_client.closed = True


async def warn_missing(text):
    warned.append(text)


real = (bot.client, bot.asyncio, bot.report_say)
bot.client, bot.asyncio, bot.report_say = ready_client, OnePassAsyncio(), warn_missing
del LOGGED[:]
try:
    run(bot.watch_known_issues())
finally:
    bot.client, bot.asyncio, bot.report_say = real
yes('with no GitHub token the watcher warns once and pauses at its normal cadence',
    sum('known issues: updates paused: no GitHub token' in line for line in LOGGED) == 1
    and len(warned) == 1 and slept == [bot.KNOWN_EVERY])
yes('the poll is no more often than once a minute (default %ds)' % bot.KNOWN_EVERY,
    bot.KNOWN_EVERY >= 60)


# -------------------- 11. one listing of the archive per forum per pass --
# #4332: _forum_post listed the forum's whole archive (_bot_threads, every
# archived thread, 100 a request) for every new post, to find one of the
# bot's with the same title, and _dev_post listed it and then let
# _forum_post list it again. So a pass cost (new posts) x (archive / 100)
# list requests, twice that in #dev-test-tasks. Each pass now lists each
# forum's archive once, and only when it makes a post.
def counted(forum):
    real, seen = forum.archived_threads, {'lists': 0, 'pages': 0}

    async def listing(limit=None, **k):
        seen['lists'] += 1
        n = 0
        async for th in real(limit=limit, **k):
            if n % 100 == 0:
                seen['pages'] += 1          # discord.py asks for 100 at a time
            n += 1
            yield th
        if n == 0:
            seen['pages'] += 1
    forum.archived_threads = listing
    return seen


def gh_paged(url):
    # The stand-in above answers every page with the whole list; this section
    # has more than 100 issues, so its lists are paged as GitHub pages them.
    rows = gh(url)
    if isinstance(rows, list) and 'per_page=100' in url and '&page=' in url:
        page = int(url.split('&page=')[1].split('&')[0])
        return rows[(page - 1) * 100:page * 100]
    return rows


for archive in (300, 1000):
    ISSUES.clear()
    COMMENTS.clear()
    TIMELINE.clear()
    HOUR[0] = '2026-10-20T09'
    UPD[0] = 0
    g, tasks, results, play, staff = server()
    run(bot.channel_setup(g, apply=True, path=os.path.join(TMP, 'lists-%d.json' % archive)))
    me = g.me
    forums = {'known-issues': bot._channel_named(g, 'known-issues', ('forum',)),
              'test-tasks': bot._channel_named(g, 'test-tasks', ('forum',)),
              'dev-test-tasks': bot._channel_named(g, 'dev-test-tasks', ('forum',))}
    for name, forum in forums.items():
        for i in range(archive):
            old = Thread('Archived %s post %d' % (name, i), [], 'An old post.', forum)
            old.archived = True
            forum.threads.append(old)
    st = {}
    run(bot.test_tasks_once(forums['test-tasks'], st, gh_paged, me_id=me.id, now='2026-10-20T08:00:00Z'))
    run(bot.dev_tasks_once(forums['dev-test-tasks'], st, gh_paged, me_id=me.id, now='2026-10-20T08:00:30Z'))
    for n in range(40):
        issue(6000 + n, 'Finding %d' % n, ['Main Findings'])
        COMMENTS[7000 + n] = [task('Fixed thing %d works' % n if n else 'Archived test-tasks post 7',
                                   'Main', '1. Try it.', 'What should happen: it works.')]
        issue(7000 + n, 'Fixed thing %d' % n, ['bug'], state='closed', reason='completed',
              closed_at=tick())
        COMMENTS[8000 + n] = [task('Dev check %d' % n, 'Dev', '1. Try it on dev.')]
        issue(8000 + n, 'Dev thing %d' % n, ['bug'])
    seen = dict((name, counted(f)) for name, f in forums.items())
    made = dict((name, len(f.threads)) for name, f in forums.items())
    kp = run(bot.known_issues_once(forums['known-issues'], {}, gh_paged, me_id=me.id))[0]
    tp = run(bot.test_tasks_once(forums['test-tasks'], st, gh_paged, me_id=me.id))[0]
    dp = run(bot.dev_tasks_once(forums['dev-test-tasks'], st, gh_paged, me_id=me.id))[0]
    new = dict((name, len(f.threads) - made[name]) for name, f in forums.items())
    yes('%d archived posts, 40 new: every new post is made, and the one whose title is '
        'already an archived post of the bot\'s is taken up, not made twice' % archive,
        len(kp) == 40 and len(tp) == 40 and len(dp) == 40
        and new == {'known-issues': 40, 'test-tasks': 39, 'dev-test-tasks': 40}
        and st['tasks']['7000']['thread_id'] == [th for th in forums['test-tasks'].threads
                                                 if th.name == 'Archived test-tasks post 7'][0].id)
    yes('  each forum\'s archive is listed once in the pass, whatever the number of new '
        'posts, #dev-test-tasks too (%s)'
        % ', '.join('%s %d listing(s), %d request(s)' % (k, v['lists'], v['pages'])
                    for k, v in sorted(seen.items())),
        all(v['lists'] == 1 for v in seen.values())
        and all(v['pages'] == archive // 100 for v in seen.values()))
    again = counted(forums['test-tasks'])
    tp = run(bot.test_tasks_once(forums['test-tasks'], st, gh_paged, me_id=me.id))[0]
    yes('  a pass that makes no new post lists no archive at all',
        tp == [] and again['lists'] == 0)

shutil.rmtree(TMP, ignore_errors=True)
print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
