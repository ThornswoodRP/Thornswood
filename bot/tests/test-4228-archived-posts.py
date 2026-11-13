"""
test-4228-archived-posts.py

Issue #4228. Discord archives a forum post after a few quiet days, and an
archived post refuses every edit (400, code 50083, "Thread is archived")
until it is unarchived. bot_forums._forum_edit edited the post's title, tags
and text without looking at th.archived, and every pass (known issues, test
tasks, dev test tasks) caught Discord's refusal with `except
discord.HTTPException: continue` and no line, so a post kept its old title,
tags and text and nothing said so. Refused removals went the same way.

The real bot_forums is imported and its helpers run against a stand-in
forum whose threads behave as Discord's do:

  A  an archived post is unarchived, edited (title, tags, text) and archived
     again, and the edit lands.
  B  an open post is edited and never archived.
  C  a dev post's follow-up messages are written while the post is open,
     before it is archived again.
  D  an edit Discord refuses for another reason (Missing Permissions) is
     logged with Discord's own words and code, the post is archived again as
     it was, and the refusal still reaches the pass, which keeps its record.
  E  a removal Discord refuses is logged the same way.
  F  a known-issues pass over an archived post brings it up to date.

Never connects to anything.
"""
import os
import sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
for _k in ('TEST_TASK_ROLES', 'LIVE_SMOKE_ADMIN_ROLES', 'GITHUB_TOKEN'):
    os.environ.pop(_k, None)
os.environ['GITHUB_TOKEN_FILE'] = ''

import discord  # noqa: E402
import harness_bot  # noqa: E402
bot = harness_bot.whole()
bot.POST_RULES = False
import bot_forums  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


LOGGED = []
# Through the bot's one view, so every module holding log logs here (harness_bot).
bot.log = lambda *a: LOGGED.append(' '.join(str(x) for x in a))


class Response(object):
    def __init__(self, status, reason):
        self.status = status
        self.reason = reason


def refusal(status, code, text):
    return discord.HTTPException(Response(status, text), {'code': code, 'message': text})


def archived_refusal():
    return refusal(400, 50083, 'Thread is archived')


class Msg(object):
    def __init__(self, mid, content, thread):
        self.id = mid
        self.content = content
        self.thread = thread

    async def edit(self, content=None, **k):
        self.thread.check('edit_message')
        self.content = content

    async def delete(self):
        self.thread.check('delete_message')
        self.thread.more.remove(self)


class Thread(object):
    """A forum post as Discord keeps it: archived, it refuses every change
       but being unarchived; `refuse` makes it refuse a change for another
       reason as well."""
    next_id = 70000

    def __init__(self, forum, name, content, archived=False):
        Thread.next_id += 1
        self.id = Thread.next_id
        self.forum = forum
        self.name = name
        self.applied_tags = []
        self.archived = archived
        self.owner_id = 2
        self.content = content
        self.more = []
        self.calls = []
        self.refuse = None
        forum.threads.append(self)
        forum.guild.threads[self.id] = self

    def check(self, what):
        self.calls.append((what, self.archived))
        if self.refuse is not None and what in self.refuse[0]:
            raise self.refuse[1]
        if self.archived:
            raise archived_refusal()

    async def edit(self, name=None, applied_tags=None, archived=None, **k):
        if archived is not None and name is None and applied_tags is None:
            self.calls.append(('archive' if archived else 'unarchive', self.archived))
            self.archived = archived
            return self
        self.check('edit_thread')
        if name is not None:
            self.name = name
        if applied_tags is not None:
            self.applied_tags = applied_tags
        if archived is not None:
            self.archived = archived
        return self

    @property
    def starter_message(self):
        th = self

        class Starter(object):
            async def edit(self, content=None, **k):
                th.check('edit_message')
                th.content = content
        return Starter()

    async def fetch_message(self, mid):
        for m in self.more:
            if m.id == mid:
                return m
        raise discord.NotFound(Response(404, 'gone'), 'Unknown Message')

    async def history(self, limit=100, oldest_first=False):
        yield Msg(self.id, self.content, self)
        for m in list(self.more):
            yield m

    async def send(self, content, **k):
        self.check('send')
        Thread.next_id += 1
        m = Msg(Thread.next_id, content, self)
        self.more.append(m)
        return m

    async def delete(self):
        self.check('delete_thread')
        self.forum.threads.remove(self)
        del self.forum.guild.threads[self.id]


class Guild(object):
    def __init__(self):
        self.threads = {}

    def get_thread(self, tid):
        return self.threads.get(tid)

    async def fetch_channel(self, tid):
        if tid in self.threads:
            return self.threads[tid]
        raise discord.NotFound(Response(404, 'gone'), 'Unknown Channel')


class Forum(object):
    def __init__(self, name):
        self.guild = Guild()
        self.name = name
        self.id = 9100
        self.threads = []
        self.available_tags = []

    async def archived_threads(self, limit=None, **k):
        for th in list(self.threads):
            if th.archived:
                yield th

    async def create_thread(self, name, content, applied_tags, **k):
        return Thread(self, name, content)


def run(c):
    """(result, the exception it raised or None)."""
    try:
        return asyncio.run(c), None
    except Exception as e:
        return None, e


# ------------------------------------------------------------------- A --
forum = Forum('known-issues')
th = Thread(forum, 'Ferry sinks', 'Old words.', archived=True)
del LOGGED[:]
ok, err = run(bot_forums._forum_edit(forum, th.id, 'Ferry sinks at Windhelm', 'New words.', []))
yes('A1 an archived post is edited: the call returns True and raises nothing (got %r, %r)'
    % (ok, err), ok is True and err is None)
yes('A1 and the title and text are the new ones (%r, %r)' % (th.name, th.content),
    th.name == 'Ferry sinks at Windhelm' and th.content == 'New words.')
yes('A2 it was unarchived before the first edit and archived again after the last (%r)'
    % (th.calls,),
    th.calls[:1] == [('unarchive', True)] and th.calls[-1:] == [('archive', False)]
    and th.archived is True)

# ------------------------------------------------------------------- B --
th = Thread(forum, 'Gold resets', 'Old words.')
ok, err = run(bot_forums._forum_edit(forum, th.id, 'Gold resets', 'New words.', []))
yes('B1 an open post is edited and left open, never archived (%r)' % (th.calls,),
    ok is True and th.content == 'New words.' and th.archived is False
    and not [c for c in th.calls if c[0] in ('archive', 'unarchive')])

# ------------------------------------------------------------------- C --
th = Thread(forum, 'Dev check', 'First part.', archived=True)
th.more.append(Msg(th.id + 500, 'Old second part.', th))
kept = [th.more[0].id]
out = []


async def follow(t):
    out.append(await bot_forums._sync_more(t, ['New second part.', 'Third part.'], kept))

ok, err = run(bot_forums._forum_edit(forum, th.id, 'Dev check', 'New first part.', [], then=follow))
yes('C1 a dev post\'s follow-ups are written while it is open (%r, %r)' % (err, th.calls),
    err is None and ok is True
    and [m.content for m in th.more] == ['New second part.', 'Third part.']
    and th.calls[-1:] == [('archive', False)] and th.archived is True)

# ------------------------------------------------------------------- D --
th = Thread(forum, 'Locked out', 'Old words.', archived=True)
th.refuse = (('edit_thread', 'edit_message'), refusal(403, 50013, 'Missing Permissions'))
del LOGGED[:]
ok, err = run(bot_forums._forum_edit(forum, th.id, 'Locked out', 'New words.', []))
yes('D1 an edit Discord refuses still reaches the pass, so its record is kept (%r)' % (err,),
    isinstance(err, discord.HTTPException))
said = ' | '.join(LOGGED)
yes('D2 and it is logged with Discord\'s own words and code (%s)' % said,
    'Missing Permissions' in said and '50013' in said and '#known-issues' in said
    and 'Locked out' in said)
yes('D3 and the post is archived again, as it was (%r)' % (th.calls,),
    th.archived is True and th.calls[-1:] == [('archive', False)])

# ------------------------------------------------------------------- E --
th = Thread(forum, 'Stuck', 'Words.')
th.refuse = (('delete_thread',), refusal(403, 50013, 'Missing Permissions'))
del LOGGED[:]
ok, err = run(bot_forums._forum_drop(forum, th.id))
said = ' | '.join(LOGGED)
yes('E1 a removal Discord refuses is logged with its words and code (%s)' % said,
    isinstance(err, discord.HTTPException) and 'Missing Permissions' in said
    and '50013' in said and 'Stuck' in said)

# ------------------------------------------------------------------- F --
forum = Forum('known-issues')
ISSUE = {'number': 40, 'title': 'Ferry sinks', 'state': 'open', 'state_reason': None,
         'closed_at': None, 'updated_at': '2026-11-12T06:00:00Z',
         'html_url': 'https://github.com/ThornswoodRP/Thornswood/issues/40',
         'repository_url': 'https://api.github.com/repos/ThornswoodRP/Thornswood',
         'labels': [{'name': 'Dev Findings'}]}


def gh(url):
    path = url.split('?')[0]
    if path.endswith('/repos/' + bot.KNOWN_REPO):
        return {'full_name': bot.KNOWN_REPO}
    if path.endswith('/comments'):      # the post's words come from this comment
        return [{'body': 'Known issue: %s\nWhat happens: it sinks.' % ISSUE['title'],
                 'created_at': ISSUE['updated_at']}]
    if path.endswith('/timeline'):
        return []
    if '/issues/' in path:
        return ISSUE
    return [ISSUE] if 'Dev%20Findings' in url or 'Dev Findings' in url else []


st = {}
run(bot_forums.known_issues_once(forum, st, gh, me_id=2))
posted = forum.threads[:1]
if posted:
    posted[0].archived = True          # quiet days pass; Discord archives it
ISSUE = dict(ISSUE, title='Ferry sinks at Windhelm', updated_at='2026-11-12T07:00:00Z')
res, err = run(bot_forums.known_issues_once(forum, st, gh, me_id=2))
yes('F1 a known-issues pass edits an archived post: it says edited, and the post '
    'has the new title (%r, %r, %r)' % (res, err, posted[0].name if posted else None),
    err is None and res is not None and res[1] == [40]
    and posted and posted[0].name == 'Ferry sinks at Windhelm' and posted[0].archived)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
